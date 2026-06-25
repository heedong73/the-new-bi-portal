from app.schemas.refresh import RefreshRunOut, SummaryOut, LongestRun

def build_summary(runs: list[RefreshRunOut]) -> SummaryOut:
    total = len(runs)
    success = sum(1 for r in runs if r.status == "success")
    failed = sum(1 for r in runs if r.status == "failed")
    in_progress = sum(1 for r in runs if r.status == "in_progress")
    completed = [r for r in runs if r.status in ("success", "failed")]
    durations = [r.durationSeconds for r in completed if r.durationSeconds is not None]
    avg = int(round(sum(durations) / len(durations))) if durations else 0
    longest = None
    all_with_dur = [r for r in runs if r.durationSeconds is not None]
    if all_with_dur:
        lr = max(all_with_dur, key=lambda r: r.durationSeconds or 0)
        longest = LongestRun(reportName=lr.reportName, durationSeconds=lr.durationSeconds or 0)
    ends = [r.endTimeLocal for r in completed if r.endTimeLocal]
    return SummaryOut(
        total=total, success=success, failed=failed, inProgress=in_progress,
        averageDurationSeconds=avg, longestRun=longest,
        lastCompletedAtLocal=max(ends) if ends else None,
    )
