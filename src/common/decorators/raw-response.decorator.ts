import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * Sends this route's return value as the response body verbatim, skipping the
 * `{ data, timestamp, path }` envelope every other route gets.
 *
 * For a route whose body *is* a file, the envelope is not metadata about the
 * payload, it is contamination of it: a data export saved to disk would carry
 * `"path": "/account/export"` inside the user's own record of their health
 * data, and anything re-importing it would have to know to unwrap first.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
