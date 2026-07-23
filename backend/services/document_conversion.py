"""Canonical document conversion adapters.

Parsers consume ConvertedDocument rather than invoking a converter directly so
conversion metadata and warnings remain durable and testable.
"""
from dataclasses import asdict, dataclass, field
from pathlib import Path
from time import perf_counter
from typing import Any

from markitdown import MarkItDown


@dataclass(frozen=True)
class ConvertedDocument:
    markdown: str
    text: str
    page_count: int | None
    filename: str
    converter: str
    converter_version: str
    warnings: list[str] = field(default_factory=list)
    duration_ms: int = 0

    def metadata(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("markdown", None)
        data.pop("text", None)
        return data


class MarkItDownConverter:
    name = "Microsoft MarkItDown"

    def __init__(self) -> None:
        self._converter = MarkItDown(enable_plugins=False)

    def convert(self, path: str | Path) -> ConvertedDocument:
        source = Path(path)
        started = perf_counter()
        result = self._converter.convert(str(source))
        markdown = (getattr(result, "text_content", None) or "").strip()
        if not markdown:
            raise ValueError("MarkItDown returned no text for this PDF")

        warnings: list[str] = []
        page_count = None
        try:
            from pypdf import PdfReader

            page_count = len(PdfReader(str(source)).pages)
        except Exception as exc:  # Conversion remains valid without page count.
            warnings.append(f"Page count unavailable: {exc}")

        try:
            from importlib.metadata import version

            converter_version = version("markitdown")
        except Exception:
            converter_version = "unknown"

        return ConvertedDocument(
            markdown=markdown,
            text=markdown,
            page_count=page_count,
            filename=source.name,
            converter=self.name,
            converter_version=converter_version,
            warnings=warnings,
            duration_ms=round((perf_counter() - started) * 1000),
        )
