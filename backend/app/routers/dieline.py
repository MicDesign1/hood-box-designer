from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.models.box_spec import (
    BoxSpec,
    CutArc,
    CutElement,
    CutLine,
    DielineGenerateResponse,
    GeometryPayload,
    LabelMarkPayload,
)
from app.models.solve import SolveRequest, SolveResponse
from app.services.dieline_generator import ArcSegment, generate_dieline_dxf, generate_dieline_svg
from app.services.solve import solve_from_request

router = APIRouter(prefix="/api/dieline", tags=["dieline"])


def _cut_payload(segment) -> CutElement:
    if isinstance(segment, ArcSegment):
        return CutArc(x1=segment.x1, y1=segment.y1, x2=segment.x2, y2=segment.y2, radius=segment.radius, sweep_flag=segment.sweep_flag)
    return CutLine(x1=segment.x1, y1=segment.y1, x2=segment.x2, y2=segment.y2)


@router.post("/generate", response_model=DielineGenerateResponse)
def generate_dieline(spec: BoxSpec) -> DielineGenerateResponse:
    svg, generated, message, warnings, derived, result = generate_dieline_svg(spec)

    geometry = None
    if result is not None:
        geometry = GeometryPayload(
            unit=result.unit,
            total_w=result.total_w,
            total_h=result.total_h,
            cuts=[_cut_payload(s) for s in result.cuts],
            creases=[(s.x1, s.y1, s.x2, s.y2) for s in result.creases],
            labels=[
                LabelMarkPayload(
                    x=label.x,
                    y=label.y,
                    kind=label.kind,
                    value=label.value,
                    letter=label.letter,
                    panel_index=label.panel_index,
                    small=label.small,
                    faint=label.faint,
                )
                for label in result.labels
            ],
        )

    return DielineGenerateResponse(
        svg=svg,
        geometry=geometry,
        fefco_code=spec.fefco_code,
        generated=generated,
        message=message,
        warnings=warnings,
        derived=derived,
    )


@router.post("/solve", response_model=SolveResponse)
def solve_dieline(request: SolveRequest) -> SolveResponse:
    try:
        return solve_from_request(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/export/dxf")
def export_dieline_dxf(spec: BoxSpec) -> Response:
    dxf_bytes, error = generate_dieline_dxf(spec)
    if dxf_bytes is None:
        raise HTTPException(status_code=501, detail=error or "DXF export unavailable.")

    filename = (
        f"fefco-{spec.fefco_code}-"
        f"{spec.length:.3f}x{spec.width:.3f}x{spec.height:.3f}in.dxf"
    )

    return Response(
        content=dxf_bytes,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )