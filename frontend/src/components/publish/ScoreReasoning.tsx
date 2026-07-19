'use client';

import type { RankingFactor, RankingReasoning } from '@/lib/api-client';
import { labels } from '@/lib/content-labels';
import {
  isNeutralFactor,
  isOverrideFeedbackFactor,
  overrideFeedbackCounts,
  overrideFeedbackInput,
  summarizeOverrideFeedback,
} from '@/lib/ranking-reasoning';

interface ScoreReasoningProps {
  reasoning: RankingReasoning;
}

/** Formats a 0..1 factor value / contribution as a short percentage. */
function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Renders raw factor inputs (`{name: value}`) as a compact inline list. */
function inputSummary(input: RankingReasoning['factors'][number]['input']): string {
  const entries = Object.entries(input);
  if (entries.length === 0) {
    return '—';
  }
  return entries.map(([key, value]) => `${key}: ${value ?? '—'}`).join(', ');
}

/**
 * The explainability panel: renders each ranking factor with its weight,
 * normalized value, and contribution to the total so an admin can see WHY a
 * platform is recommended before publishing. The number alone is never enough.
 *
 * v2 (Phase 5) adds a fifth factor, `override_feedback`, which scores the
 * admin's own past override behaviour back at them. A generic key:value dump
 * is not good enough for that one — it gets a dedicated readable breakdown
 * below the table, including an explicit NEUTRAL callout when the sample was
 * too small for the signal to move the score.
 */
export function ScoreReasoning({ reasoning }: ScoreReasoningProps): JSX.Element {
  const overrideFactor = reasoning.factors.find(isOverrideFeedbackFactor) ?? null;

  return (
    <div>
      <p className="mb-2">
        <span className="badge bg-dark">{labels.engineVersion(reasoning.engineVersion)}</span>
      </p>
      <div className="table-responsive">
        <table className="table table-sm align-middle mb-2">
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col" className="text-end">
                Weight
              </th>
              <th scope="col" className="text-end">
                Value
              </th>
              <th scope="col" className="text-end">
                Contribution
              </th>
              <th scope="col">Inputs</th>
            </tr>
          </thead>
          <tbody>
            {reasoning.factors.map((factor) => (
              <tr key={factor.name}>
                <td>{labels.factor(factor.name)}</td>
                <td className="text-end">{pct(factor.weight)}</td>
                <td className="text-end">{pct(factor.value)}</td>
                <td className="text-end fw-semibold">{factor.contribution.toFixed(3)}</td>
                <td className="small text-muted">{inputSummary(factor.input)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3} className="text-end">
                Total score
              </th>
              <td className="text-end fw-bold">{reasoning.total.toFixed(3)}</td>
              <td className="small text-muted">engine {reasoning.engineVersion}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {overrideFactor && <OverrideFeedbackDetail factor={overrideFactor} />}
    </div>
  );
}

/**
 * The human-readable rendering of `override_feedback`. Shows the raw decision
 * counts, not just the derived value, so the admin can argue with the signal
 * rather than take it on faith.
 */
function OverrideFeedbackDetail({ factor }: { factor: RankingFactor }): JSX.Element {
  const input = overrideFeedbackInput(factor);
  const neutral = isNeutralFactor(input);
  const counts = overrideFeedbackCounts(input);

  return (
    <div className="border rounded p-2 mt-2">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
        <h4 className="h6 mb-0">Override feedback</h4>
        {neutral && (
          <span className="badge bg-warning text-dark">NEUTRAL — no effect on this score</span>
        )}
      </div>
      <p className="small mb-2">{summarizeOverrideFeedback(input)}</p>
      {counts.length === 0 ? (
        <p className="small text-muted mb-0">No decision counts recorded for this factor.</p>
      ) : (
        <ul className="list-unstyled small mb-0">
          {counts.map((row) => (
            <li key={row.label}>
              {row.label}: <span className="fw-semibold">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
