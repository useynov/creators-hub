/**
 * A refusal the creator or the team should read: "the deadline has passed", "not enough coins".
 * `code` is stable for the apps, `message` is plain English for people.
 * Lives in its own module so that account.ts and pipeline.ts can throw it without importing
 * service.ts (which imports them). service.ts re-exports it.
 */
export class HubError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
