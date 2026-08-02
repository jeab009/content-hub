import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route (or whole controller) out of the global SessionAuthGuard
 * (registered as APP_GUARD in AppModule). Every route is authenticated by
 * default; this is the explicit, greppable exception — not the other way
 * around (see M-1: ConnectedAccountsController shipped without a guard
 * because auth was opt-in per controller).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
