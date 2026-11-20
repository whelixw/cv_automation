"""Proposed v1 contracts; the legacy HTTP API is unchanged."""

from pathlib import PurePosixPath, PureWindowsPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal[1] = 1


class Capture(Contract):
    url: str = Field(min_length=1)
    title: str
    company: str
    description: str = Field(min_length=1)
    method: Literal["selection", "picker", "recipe", "structured", "site", "manual"]
    confirmed: bool
    captured_at: str = Field(min_length=1)
    recipe_id: str | None = None

    @field_validator("description")
    @classmethod
    def nonblank_description(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Description must contain text")
        return value


class SelectionRule(Contract):
    field: Literal["description", "title", "company", "location", "requirements"]
    include: list[str] = Field(min_length=1)
    exclude: list[str] = Field(default_factory=list)


class Recipe(Contract):
    id: str = Field(min_length=1)
    revision: int = Field(ge=1)
    hostname: str = Field(min_length=1)
    path_pattern: str = Field(min_length=1)
    rules: list[SelectionRule] = Field(min_length=1)
    enabled: bool = True


class Application(Contract):
    id: str = Field(min_length=1)
    directory: str = Field(min_length=1)
    capture: Capture
    status: Literal[
        "draft",
        "captured",
        "analyzing",
        "awaiting_review",
        "generating",
        "rendering",
        "draft_ready",
        "approved",
    ]
    current_version: str | None = None
    approved_version: str | None = None


class AgentEvent(Contract):
    run_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    phase: Literal["analyze", "generate", "revise", "render", "validate"]
    status: Literal[
        "queued", "running", "complete", "failed", "cancelled", "interrupted"
    ]
    message: str
    error_code: str | None = None


class Artifact(Contract):
    path: str = Field(min_length=1)
    kind: Literal[
        "cv_source", "letter_source", "notes", "cv_pdf", "letter_pdf", "preview"
    ]
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @field_validator("path")
    @classmethod
    def relative_path(cls, value: str) -> str:
        path = PurePosixPath(value)
        windows = PureWindowsPath(value)
        if (
            "\\" in value
            or path.is_absolute()
            or windows.drive
            or ".." in path.parts
            or ":" in value
            or value == "."
        ):
            raise ValueError("Artifact path must be workspace-relative POSIX syntax")
        return value


class ArtifactManifest(Contract):
    application_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    version_id: str = Field(min_length=1)
    rendercv_version: str = Field(min_length=1)
    latex_compiler: Literal["tectonic"]
    reference_revisions: dict[str, str]
    artifacts: list[Artifact] = Field(min_length=1)


CONTRACTS = (Capture, Recipe, Application, AgentEvent, ArtifactManifest)
