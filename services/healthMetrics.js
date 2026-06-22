// services/healthMetrics.js — pure scoring logic for the health heatmap.
//
// Closed-gap handling differs per metric:
//   - highRiskGaps: EXCLUDES closed gaps (they are completed work, not
//                   current risk).
//   - totalGaps:    INCLUDES closed gaps (a count of every gap in the
//                   session).
//   - computeBucketMetrics.gapScore: INCLUDES closed gaps.
// Hidden environments are the caller's responsibility: pass the visible
// set via the `environments` param.

// computeLifecycleRisk · pure read of a current instance's
// endOfSupportDate / endOfServiceLifeDate against a reference date.
// Severity order (most to least severe): critical (past end of service
// life) > high (past end of support) > elevated (either date within the
// next 180 days) > none. Weights feed computeBucketMetrics' totalScore
// using the same scale as gap urgency (High=3, Medium=2, Low=1).
const LIFECYCLE_WARNING_WINDOW_DAYS = 180;

export function computeLifecycleRisk(instance, referenceDate) {
  const none = { severity: "none", weight: 0, reason: null, days: null };
  if (!instance || instance.state !== "current") return none;

  const now = referenceDate || new Date();
  const daysUntil = (dateStr) => Math.round((new Date(dateStr + "T00:00:00").getTime() - now.getTime()) / 86400000);

  const eosl = instance.endOfServiceLifeDate;
  const eos  = instance.endOfSupportDate;

  if (eosl) {
    const d = daysUntil(eosl);
    if (d < 0) return { severity: "critical", weight: 3, reason: "past end of service life", days: d };
  }
  if (eos) {
    const d = daysUntil(eos);
    if (d < 0) return { severity: "high", weight: 2, reason: "past end of support", days: d };
    if (d <= LIFECYCLE_WARNING_WINDOW_DAYS) return { severity: "elevated", weight: 1, reason: "approaching end of support", days: d };
  }
  if (eosl) {
    const d = daysUntil(eosl);
    if (d <= LIFECYCLE_WARNING_WINDOW_DAYS) return { severity: "elevated", weight: 1, reason: "approaching end of service life", days: d };
  }
  return none;
}

export function getHealthSummary(session, layers, environments) {
  return {
    totalBuckets:  (layers?.length || 0) * (environments?.length || 0),
    totalCurrent:  (session.instances || []).filter(i => i.state === "current").length,
    totalDesired:  (session.instances || []).filter(i => i.state === "desired").length,
    totalGaps:     (session.gaps || []).length,
    // Exclude closed gaps: they represent completed work, not current risk.
    highRiskGaps:  (session.gaps || []).filter(g => g.urgency === "High" && g.status !== "closed").length
  };
}

export function computeBucketMetrics(layerId, envId, session) {
  const current = (session.instances || []).filter(
    i => i.state === "current" && i.layerId === layerId && i.environmentId === envId
  );
  let currentScore = 0;
  let lifecycleScore = 0;
  const lifecycleRisks = [];
  current.forEach(i => {
    if      (i.criticality === "High")   currentScore += 2;
    else if (i.criticality === "Medium") currentScore += 1;
    else if (i.criticality === "Low")    currentScore += 0.5;

    const risk = computeLifecycleRisk(i);
    if (risk.severity !== "none") {
      lifecycleScore += risk.weight;
      lifecycleRisks.push({ instance: i, risk });
    }
  });

  const gaps = (session.gaps || []).filter(g => {
    const layers = g.affectedLayers?.length ? g.affectedLayers : [g.layerId];
    const envs   = g.affectedEnvironments || [];
    return layers.includes(layerId) && (envs.length === 0 || envs.includes(envId));
  });
  let gapScore = 0;
  gaps.forEach(g => {
    if      (g.urgency === "High")   gapScore += 3;
    else if (g.urgency === "Medium") gapScore += 2;
    else if (g.urgency === "Low")    gapScore += 1;
  });

  const totalScore = currentScore + gapScore + lifecycleScore;
  const hasData    = current.length > 0 || gaps.length > 0;
  return { totalScore, currentScore, gapScore, lifecycleScore, lifecycleRisks, hasData, current, gaps };
}

export function scoreToRiskLabel(totalScore, hasData) {
  if (!hasData)         return "No data";
  if (totalScore === 0) return "Stable";
  if (totalScore <= 3)  return "Minor";
  if (totalScore <= 6)  return "Moderate";
  return "High risk";
}

export function scoreToClass(totalScore, hasData) {
  if (!hasData || totalScore === 0) return "bucket-empty";
  if (totalScore <= 3)  return "bucket-low";
  if (totalScore <= 6)  return "bucket-med";
  return "bucket-high";
}
