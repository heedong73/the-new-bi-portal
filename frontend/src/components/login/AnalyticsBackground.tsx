import './AnalyticsBackground.css'

/** 로그인 화면의 장식용 Ivory Editorial 배경. */
export default function AnalyticsBackground() {
  return (
    <div className="analytics-background" aria-hidden="true">
      <div className="analytics-background__surface" />
      <div className="analytics-background__grid" />
      <div className="analytics-background__rings" />
      <div className="analytics-background__panel" />
      <div className="analytics-background__divider" />
      <div className="analytics-background__accent" />
    </div>
  )
}
