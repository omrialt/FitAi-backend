import { Global, Module } from '@nestjs/common';

import { AnthropicService } from './anthropic.service';

/**
 * Global so the four AI features share one client and therefore one set of
 * `lastCallAt` / `lastError` counters. Importing it per feature module would
 * still give one instance under Nest's default singleton scope, but it would
 * make that a coincidence of the DI container rather than a stated intent —
 * and the status route's answer depends on it being one.
 */
@Global()
@Module({
  providers: [AnthropicService],
  exports: [AnthropicService],
})
export class AnthropicModule {}
