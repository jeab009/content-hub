'use client';

import type { RankingReasoning } from '@/lib/api-client';
import { labels } from '@/lib/content-labels';

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
 */
export function ScoreReasoning({ reasoning }: ScoreReasoningProps): JSX.Element {
  return (
    <div>
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
    </div>
  );
}
