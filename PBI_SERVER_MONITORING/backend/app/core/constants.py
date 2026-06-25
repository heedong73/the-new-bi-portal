"""Shared application constants.

Kept in one place so the Backend and Frontend use the exact same user-facing
strings. ``NO_DATASET_NAME`` mirrors ``frontend/src/i18n/ko.ts`` (``noDataset``)
and ``frontend/src/mocks/fixtures.ts`` (``NO_DATASET_NAME``).
"""

from __future__ import annotations

# Displayed as the dataset name for paginated reports, which have no associated
# semantic model (Requirement 6.3). Must stay identical to the Frontend string.
NO_DATASET_NAME = "데이터셋 없음"
