from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.models.box_spec import BoxSpec, DielineGenerateResponse
from app.services.dieline_generator import generate_dieline_dxf, generate_dieline_svg

router = APIRouter(prefix="/api/dieline", tags=["dieline"])


@router.post("/generate", response_model=DielineGenerateResponse)
def generate_dieline(spec: BoxSpec) -> DielineGenerateResponse:
    svg, generated, message, warnings, derived = generate_dieline_svg(spec)
    return DielineGenerateResponse(
        svg=svg,
        fefco_code=spec.fefco_code,
        generated=generated,
        message=message,
        warnings=warnings,
        derived=derived,
    )


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