import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TOKEN_REFRESH_QUEUE } from '../queue.constants';
import { ConnectedAccountsService } from '../../connected-accounts/connected-accounts.service';

const REFRESH_WINDOW_DAYS = 7;

/**
 * Daily job: finds every connected account whose token expires within the
 * next 7 days and is still `connected`, and re-exchanges it via Meta's
 * long-lived-token refresh flow (approved architecture: "daily job that
 * queries ConnectedAccount WHERE token_expires_at < now()+7days AND
 * status=connected and re-exchanges via Meta's refresh").
 */
@Processor(TOKEN_REFRESH_QUEUE)
export class TokenRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(TokenRefreshProcessor.name);

  constructor(private readonly connectedAccountsService: ConnectedAccountsService) {
    super();
  }

  async process(job: Job): Promise<{ processed: number }> {
    const expiringAccounts =
      await this.connectedAccountsService.findAccountsExpiringWithin(REFRESH_WINDOW_DAYS);

    this.logger.log(
      `Token refresh sweep (job ${job.id}): ${expiringAccounts.length} account(s) due`,
    );

    for (const account of expiringAccounts) {
      await this.connectedAccountsService.refreshToken(account.id);
    }

    return { processed: expiringAccounts.length };
  }
}
