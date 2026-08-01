import { AdChannel } from '@prisma/client';
import { AuditLogService } from '../../../common/audit/audit-log.service';
import { PaidIntegrationUnavailableError } from './paid.errors';
import { PaidLiveAdapter } from './paid-live.adapter';

/**
 * WBS 7D.2 acceptance criteria, mirroring
 * `commerce-adapter.contract.spec.ts`'s "live commerce adapters" block
 * exactly in shape:
 *
 *   (a) selecting the live implementation throws the actionable error,
 *       audited correctly;
 *   (b) zero network I/O — `fetch` is never called.
 *
 * See `../../../testing/separation/paid-no-live-http-client.spec.ts` for the
 * repo-wide structural proof that no live HTTP client code exists anywhere
 * under `src/modules/paid/` — this file only proves the one class's runtime
 * behavior.
 */
describe('PaidLiveAdapter (7D.2 rejecting stub)', () => {
  function build(): { adapter: PaidLiveAdapter; record: jest.Mock } {
    const record = jest.fn();
    const audit = { record } as unknown as AuditLogService;
    return { adapter: new PaidLiveAdapter(audit), record };
  }

  it('exposes the meta channel', () => {
    const { adapter } = build();
    expect(adapter.channel).toBe(AdChannel.meta);
  });

  it('rejects fetchCampaignPerformance with PaidIntegrationUnavailableError, audited, zero I/O', async () => {
    const { adapter, record } = build();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    try {
      await expect(
        adapter.fetchCampaignPerformance({
          credentials: null,
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-07-07'),
        }),
      ).rejects.toThrow(PaidIntegrationUnavailableError);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0][0]).toMatchObject({
        actor: 'system:paid-adapter',
        action: 'paid_adapter_unavailable',
        result: 'failure',
        meta: { channel: AdChannel.meta, method: 'fetchCampaignPerformance' },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects the same way when credentials are supplied — the stub has no live path at all', async () => {
    const { adapter } = build();

    await expect(
      adapter.fetchCampaignPerformance({
        credentials: { accessToken: 'token', adAccountId: 'act_123' },
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
      }),
    ).rejects.toThrow(PaidIntegrationUnavailableError);
  });

  it('names the missing ads_read scope and points at the meta-app-review-status and 7D spec docs', async () => {
    const { adapter } = build();

    await expect(
      adapter.fetchCampaignPerformance({
        credentials: null,
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
      }),
    ).rejects.toThrow(/ads_read/);
    await expect(
      adapter.fetchCampaignPerformance({
        credentials: null,
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
      }),
    ).rejects.toThrow(/docs\/meta-app-review-status\.md/);
    await expect(
      adapter.fetchCampaignPerformance({
        credentials: null,
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
      }),
    ).rejects.toThrow(/docs\/phase7d-live-integration-spec\.md/);
  });
});
