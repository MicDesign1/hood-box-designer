"""DXF geometry validator — reads a DXF file on disk and reports geometry
defects that CAD/dieline validation engines (e.g. ArtiosCAD) reject, even when
the underlying coordinate math is correct.

Validates the artifact, not the intention: this parses raw DXF entities with
`ezdxf` and never calls into `build_dieline`/`build_dxf`. A bug introduced only
at export time (or in a hand-edited/foreign DXF) is exactly what this is meant
to catch.

Coincidence model (see `skills/dieline/references/artios-dxf-conventions.md`
for the exemplar evidence this is based on): endpoints within `snap_tol` of
each other are treated as the same vertex — exact float equality is *wrong*
even for ArtiosCAD's own exports, which carry ~1e-5 endpoint wobble. Gaps
larger than `snap_tol` but no larger than `near_tol` are the "butted, not
connected" defect (R4); anything with no neighbour within `near_tol` at all is
dangling (R3). Rules are never collapsed into a single defect bucket — each
class has a distinct cause.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dieline_core.scoring import normalize_scoring_flute

DEFAULT_SNAP_TOL = 1e-4
DEFAULT_NEAR_TOL = 1e-3

# First-pass values from skills/dieline/references/tab-and-slot-conventions.md
# -- read from that file, never re-derived here. Flags mismatches only when
# the caller declares --flute; without it, slot widths are informational.
SLOT_WIDTH_IN: dict[str, float] = {"B": 0.25, "C": 0.25, "DW": 0.5}
SLOT_WIDTH_TOLERANCE_IN = 0.02

# Heuristic ceiling for "this short edge is plausibly a slot floor, not a main
# panel edge" in the R8 notch detector. Generous on purpose -- see build_help_epilog.
SLOT_CANDIDATE_MAX_LENGTH_IN = 4.0

OURS_CUT_LAYER = "CUT"
OURS_CREASE_LAYER = "CREASE"
ARTIOS_DESIGN_LAYER = "Design"
ARTIOS_CUT_COLOR = 1
ARTIOS_CREASE_COLOR = 2

RULE_HELP: dict[str, str] = {
    "R1": "No duplicate cut entities (identical or reversed endpoints, within --snap-tol).",
    "R2": "No zero-length or sub-snap-tol cut segments/arcs.",
    "R3": "No dangling cut endpoints -- every cut endpoint must be shared by another cut entity.",
    "R4": "No near-coincident-but-not-connected cut endpoints -- gap in (snap-tol, near-tol]; the 'butted, not connected' defect.",
    "R5": "Cut geometry must form exactly one closed chain; reports chain count and break points otherwise.",
    "R6": "No two cut entities crossing at a point that isn't a shared vertex (overshoot / X-where-an-L-belongs).",
    "R7": "Every crease endpoint must land on a cut VERTEX, not mid-span of a cut entity (a T-junction is a defect even with exact geometric contact).",
    "R8": "Slot width per detected slot: nonzero; reported; flagged only if it disagrees with tab-and-slot-conventions.md and --flute was given.",
    "R9": "Cut/crease must be distinguishable under a recognized convention (ours: CUT/CREASE layers; ArtiosCAD: Design-layer color 1/2). Detecting neither is a defect.",
}


@dataclass
class Defect:
    rule: str
    message: str
    points: tuple[tuple[float, float], ...] = ()
    handles: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule,
            "message": self.message,
            "points": [list(p) for p in self.points],
            "handles": list(self.handles),
        }


@dataclass
class Entity:
    kind: str  # "LINE" | "ARC"
    layer: str
    color: int
    linetype: str
    handle: str
    p1: tuple[float, float]
    p2: tuple[float, float]
    center: tuple[float, float] | None = None
    radius: float | None = None


@dataclass
class ChainInfo:
    count: int
    closed: bool
    details: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ValidationReport:
    path: str
    convention: str
    defects: list[Defect]
    info: list[str]
    counts: dict[str, int]
    slot_widths: list[float]
    chain_info: ChainInfo | None

    @property
    def ok(self) -> bool:
        return not self.defects

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "convention": self.convention,
            "ok": self.ok,
            "defects": [d.to_dict() for d in self.defects],
            "info": self.info,
            "counts": self.counts,
            "slot_widths": self.slot_widths,
        }


class _VertexIndex:
    """Welds nearby points into clusters within `tol`. O(n^2) -- fine at
    dieline entity counts (tens to low hundreds)."""

    def __init__(self, tol: float) -> None:
        self.tol = tol
        self._reps: list[list[float]] = []  # [sum_x, sum_y, count]

    def find_or_add(self, point: tuple[float, float]) -> int:
        for index, (sum_x, sum_y, count) in enumerate(self._reps):
            if math.hypot(point[0] - sum_x / count, point[1] - sum_y / count) < self.tol:
                self._reps[index][0] += point[0]
                self._reps[index][1] += point[1]
                self._reps[index][2] += 1
                return index
        self._reps.append([point[0], point[1], 1])
        return len(self._reps) - 1

    def point(self, cluster_id: int) -> tuple[float, float]:
        sum_x, sum_y, count = self._reps[cluster_id]
        return (sum_x / count, sum_y / count)

    def __len__(self) -> int:
        return len(self._reps)


def _load_entities(path: Path) -> list[Entity]:
    import ezdxf

    doc = ezdxf.readfile(str(path))
    msp = doc.modelspace()
    entities: list[Entity] = []
    for e in msp:
        if e.dxftype() == "LINE":
            entities.append(
                Entity(
                    kind="LINE",
                    layer=e.dxf.layer,
                    color=e.dxf.color,
                    linetype=e.dxf.linetype,
                    handle=e.dxf.handle,
                    p1=(e.dxf.start.x, e.dxf.start.y),
                    p2=(e.dxf.end.x, e.dxf.end.y),
                )
            )
        elif e.dxftype() == "ARC":
            cx, cy = e.dxf.center.x, e.dxf.center.y
            radius = e.dxf.radius
            a1 = math.radians(e.dxf.start_angle)
            a2 = math.radians(e.dxf.end_angle)
            p1 = (cx + radius * math.cos(a1), cy + radius * math.sin(a1))
            p2 = (cx + radius * math.cos(a2), cy + radius * math.sin(a2))
            entities.append(
                Entity(
                    kind="ARC",
                    layer=e.dxf.layer,
                    color=e.dxf.color,
                    linetype=e.dxf.linetype,
                    handle=e.dxf.handle,
                    p1=p1,
                    p2=p2,
                    center=(cx, cy),
                    radius=radius,
                )
            )
    return entities


def _detect_convention(entities: list[Entity]) -> tuple[str, list[Entity], list[Entity]]:
    has_ours = any(e.layer.upper() in (OURS_CUT_LAYER, OURS_CREASE_LAYER) for e in entities)
    if has_ours:
        cuts = [e for e in entities if e.layer.upper() == OURS_CUT_LAYER]
        creases = [e for e in entities if e.layer.upper() == OURS_CREASE_LAYER]
        return "ours", cuts, creases

    has_artios = any(
        e.layer == ARTIOS_DESIGN_LAYER and e.color in (ARTIOS_CUT_COLOR, ARTIOS_CREASE_COLOR) for e in entities
    )
    if has_artios:
        cuts = [e for e in entities if e.layer == ARTIOS_DESIGN_LAYER and e.color == ARTIOS_CUT_COLOR]
        creases = [e for e in entities if e.layer == ARTIOS_DESIGN_LAYER and e.color == ARTIOS_CREASE_COLOR]
        return "artios", cuts, creases

    # Unknown convention: best-effort, treat every LINE/ARC as a cut candidate
    # so R1/R2/R3/R5/R6 still run; no creases identified, so R7 is skipped.
    return "unknown", list(entities), []


def _point_segment_distance(
    point: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> tuple[float, float]:
    px, py = point
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq < 1e-18:
        return math.hypot(px - ax, py - ay), 0.0
    t = ((px - ax) * dx + (py - ay) * dy) / length_sq
    proj_x, proj_y = ax + t * dx, ay + t * dy
    return math.hypot(px - proj_x, py - proj_y), t


def _segment_intersection(
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    p4: tuple[float, float],
) -> tuple[float, float] | None:
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    x4, y4 = p4
    denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denom) < 1e-12:
        return None  # parallel or collinear -- not handled by this rule
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
    u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom
    margin = 1e-9
    if -margin <= t <= 1 + margin and -margin <= u <= 1 + margin:
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    return None


def validate_dxf(
    path: str | Path,
    *,
    snap_tol: float = DEFAULT_SNAP_TOL,
    near_tol: float = DEFAULT_NEAR_TOL,
    flute: str | None = None,
) -> ValidationReport:
    path = Path(path)
    entities = _load_entities(path)
    convention, cut_entities, crease_entities = _detect_convention(entities)

    defects: list[Defect] = []
    info: list[str] = []

    vidx = _VertexIndex(snap_tol)
    entity_clusters: list[tuple[int, int]] = []
    for e in cut_entities:
        entity_clusters.append((vidx.find_or_add(e.p1), vidx.find_or_add(e.p2)))

    # R2 -- zero-length / degenerate, before building the graph (these are
    # excluded from graph analysis below so they don't distort degree counts).
    degenerate_indices: set[int] = set()
    for index, e in enumerate(cut_entities):
        length = math.hypot(e.p1[0] - e.p2[0], e.p1[1] - e.p2[1])
        if e.kind == "ARC" and e.radius is not None and e.radius < snap_tol:
            defects.append(Defect("R2", f"degenerate arc (radius {e.radius:.6g} < snap-tol)", (e.p1, e.p2), (e.handle,)))
            degenerate_indices.add(index)
        elif length < snap_tol:
            defects.append(Defect("R2", f"zero-length cut {e.kind.lower()} (length {length:.6g} < snap-tol)", (e.p1, e.p2), (e.handle,)))
            degenerate_indices.add(index)

    graph_indices = [i for i in range(len(cut_entities)) if i not in degenerate_indices]

    all_used: set[int] = set()
    for i in graph_indices:
        ca, cb = entity_clusters[i]
        all_used.add(ca)
        all_used.add(cb)

    degree: dict[int, int] = defaultdict(int)
    cluster_handles: dict[int, list[str]] = defaultdict(list)
    for i in graph_indices:
        ca, cb = entity_clusters[i]
        degree[ca] += 1
        degree[cb] += 1
        cluster_handles[ca].append(cut_entities[i].handle)
        cluster_handles[cb].append(cut_entities[i].handle)

    # R1 -- duplicate entities (identical or reversed endpoints).
    groups: dict[frozenset[int], list[int]] = defaultdict(list)
    for i in graph_indices:
        groups[frozenset(entity_clusters[i])].append(i)
    for key, idxs in groups.items():
        if len(idxs) < 2:
            continue
        subgroups: dict[tuple[str, float | None], list[int]] = defaultdict(list)
        for i in idxs:
            e = cut_entities[i]
            radius_key = round(e.radius, 4) if e.radius is not None else None
            subgroups[(e.kind, radius_key)].append(i)
        for sub_idxs in subgroups.values():
            if len(sub_idxs) < 2:
                continue
            pts = tuple(vidx.point(c) for c in key)
            handles = tuple(cut_entities[i].handle for i in sub_idxs)
            defects.append(Defect("R1", f"{len(sub_idxs)} cut entities share the same endpoints (duplicate or reversed)", pts, handles))

    # R3 / R4 -- dangling vs. near-coincident-but-unconnected.
    handled: set[int] = set()
    deg1 = [c for c in all_used if degree[c] == 1]
    for c in deg1:
        if c in handled:
            continue
        p = vidx.point(c)
        best_other: int | None = None
        best_dist = math.inf
        for other in all_used:
            if other == c:
                continue
            q = vidx.point(other)
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if d < best_dist:
                best_dist = d
                best_other = other
        if best_other is not None and best_dist <= near_tol:
            q = vidx.point(best_other)
            handles = tuple(cluster_handles[c][:1] + cluster_handles[best_other][:1])
            defects.append(Defect("R4", f"cut endpoints {best_dist:.6g} in apart -- butted, not connected", (p, q), handles))
            handled.add(c)
            if degree.get(best_other) == 1:
                handled.add(best_other)
        else:
            defects.append(Defect("R3", "dangling cut endpoint -- not shared by any other cut entity", (p,), tuple(cluster_handles[c][:1])))
            handled.add(c)

    # R5 -- single closed chain, walked via shared (snap-tol) coordinates.
    parent: dict[int, int] = {c: c for c in all_used}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in graph_indices:
        union(*entity_clusters[i])

    components: dict[int, list[int]] = defaultdict(list)
    for c in all_used:
        components[find(c)].append(c)
    comp_edges: dict[int, int] = defaultdict(int)
    for i in graph_indices:
        comp_edges[find(entity_clusters[i][0])] += 1

    chain_details: list[dict[str, Any]] = []
    for root, verts in components.items():
        edges = comp_edges[root]
        break_points = [v for v in verts if degree[v] != 2]
        closed = not break_points and edges == len(verts)
        chain_details.append(
            {
                "vertices": len(verts),
                "edges": edges,
                "closed": closed,
                "break_points": [vidx.point(v) for v in break_points],
            }
        )

    single_closed_chain = len(components) == 1 and chain_details and chain_details[0]["closed"]
    chain_info = ChainInfo(count=len(components), closed=single_closed_chain, details=chain_details)
    if not single_closed_chain:
        for idx, detail in enumerate(chain_details):
            status = "closed" if detail["closed"] else "OPEN/BRANCHING"
            defects.append(
                Defect(
                    "R5",
                    f"chain {idx + 1}/{len(chain_details)}: {detail['vertices']} vertices, {detail['edges']} edges, {status}",
                    tuple(detail["break_points"]),
                    (),
                )
            )
    info.append(f"R5: {len(components)} chain(s) found; single closed chain: {single_closed_chain}")

    # R6 -- crossings without a shared vertex (LINE-LINE only; see RULE_HELP).
    line_indices = [i for i in graph_indices if cut_entities[i].kind == "LINE"]
    for a_pos in range(len(line_indices)):
        i = line_indices[a_pos]
        ca_i, cb_i = entity_clusters[i]
        for b_pos in range(a_pos + 1, len(line_indices)):
            j = line_indices[b_pos]
            ca_j, cb_j = entity_clusters[j]
            if {ca_i, cb_i} & {ca_j, cb_j}:
                continue  # shares an endpoint cluster -- legitimate connection
            e_i, e_j = cut_entities[i], cut_entities[j]
            hit = _segment_intersection(e_i.p1, e_i.p2, e_j.p1, e_j.p2)
            if hit is not None:
                defects.append(
                    Defect(
                        "R6",
                        "cut entities cross without a shared vertex at the crossing",
                        (hit,),
                        (e_i.handle, e_j.handle),
                    )
                )

    # R7 -- crease endpoints must land on a cut vertex, not mid-span.
    for ce in crease_entities:
        for p in (ce.p1, ce.p2):
            nearest_dist = min((math.hypot(p[0] - vidx.point(c)[0], p[1] - vidx.point(c)[1]) for c in all_used), default=math.inf)
            if nearest_dist <= snap_tol:
                continue
            midspan_hit: Entity | None = None
            for i in graph_indices:
                e = cut_entities[i]
                if e.kind != "LINE":
                    continue
                dist, t = _point_segment_distance(p, e.p1, e.p2)
                if dist <= near_tol and 0.0 <= t <= 1.0:
                    midspan_hit = e
                    break
            if midspan_hit is not None:
                defects.append(
                    Defect(
                        "R7",
                        f"crease endpoint lands mid-span of cut entity {midspan_hit.handle}, not at a shared vertex",
                        (p,),
                        (ce.handle, midspan_hit.handle),
                    )
                )
            else:
                defects.append(
                    Defect("R7", "crease endpoint does not terminate on any cut geometry", (p,), (ce.handle,))
                )

    # R8 -- slot width, best-effort notch detection over the walked chain.
    slot_widths: list[float] = []
    if single_closed_chain:
        root = find(next(iter(all_used)))
        edges_by_vertex: dict[int, list[int]] = defaultdict(list)
        for i in graph_indices:
            ca, cb = entity_clusters[i]
            edges_by_vertex[ca].append(cb)
            edges_by_vertex[cb].append(ca)
        start = components[root][0]
        chain_walk = [start]
        visited_edges: set[frozenset[int]] = set()
        cur = start
        first_next = edges_by_vertex[cur][0]
        visited_edges.add(frozenset((cur, first_next)))
        chain_walk.append(first_next)
        cur = first_next
        while cur != start:
            options = [v for v in edges_by_vertex[cur] if frozenset((cur, v)) not in visited_edges]
            nxt = options[0]
            visited_edges.add(frozenset((cur, nxt)))
            chain_walk.append(nxt)
            cur = nxt
        n = len(chain_walk) - 1

        def seg_len(a: int, b: int) -> float:
            pa, pb = vidx.point(a), vidx.point(b)
            return math.hypot(pa[0] - pb[0], pa[1] - pb[1])

        def unit(a: int, b: int) -> tuple[float, float]:
            pa, pb = vidx.point(a), vidx.point(b)
            length = seg_len(a, b)
            return ((pb[0] - pa[0]) / length, (pb[1] - pa[1]) / length) if length > 0 else (0.0, 0.0)

        expected = SLOT_WIDTH_IN.get(normalize_scoring_flute(flute) or "") if flute else None
        for i in range(n):
            a, b, c, d = chain_walk[i - 1], chain_walk[i], chain_walk[(i + 1) % n], chain_walk[(i + 2) % n]
            l1, l2, l3 = seg_len(a, b), seg_len(b, c), seg_len(c, d)
            if l2 > SLOT_CANDIDATE_MAX_LENGTH_IN or l1 == 0 or l3 == 0:
                continue
            u1, u2, u3 = unit(a, b), unit(b, c), unit(c, d)
            dot12 = abs(u1[0] * u2[0] + u1[1] * u2[1])
            dot23 = abs(u2[0] * u3[0] + u2[1] * u3[1])
            dot13 = abs(u1[0] * u3[0] + u1[1] * u3[1])
            if dot12 < 0.15 and dot23 < 0.15 and dot13 > 0.85 and abs(l1 - l3) < max(l1, l3) * 0.3:
                slot_widths.append(l2)
                if l2 < snap_tol:
                    defects.append(Defect("R8", "slot width is zero", (vidx.point(b), vidx.point(c)), ()))
                elif expected is not None and abs(l2 - expected) > SLOT_WIDTH_TOLERANCE_IN:
                    defects.append(
                        Defect(
                            "R8",
                            f"slot width {l2:.4g} in disagrees with tab-and-slot-conventions.md ({expected:.4g} in for flute {flute})",
                            (vidx.point(b), vidx.point(c)),
                            (),
                        )
                    )
        info.append(f"R8: {len(slot_widths)} slot(s) detected: {[round(w, 4) for w in slot_widths]}")
    else:
        info.append("R8: skipped -- cut geometry is not a single closed chain")

    # R9 -- recognized cut/crease convention.
    if convention == "unknown":
        defects.append(
            Defect("R9", "no recognized cut/crease convention detected (neither CUT/CREASE layers nor ArtiosCAD Design-layer color 1/2)", (), ())
        )
    info.append(f"R9: detected convention = {convention}")

    counts = {rule: sum(1 for d in defects if d.rule == rule) for rule in RULE_HELP}

    return ValidationReport(
        path=str(path),
        convention=convention,
        defects=defects,
        info=info,
        counts=counts,
        slot_widths=slot_widths,
        chain_info=chain_info,
    )
