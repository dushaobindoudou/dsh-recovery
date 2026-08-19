/**
 * The plugin entry: mounts the `/doctor` command and the settings-page
 * Remote into a profile.
 *
 * @module
 */


/** Resolve the environment the plugin operates on, or an error. */
export declare function resolveEnv(): { env: import('./types.js').CheckEnv; error?: undefined } | { error: string; env?: undefined };

/** The cordis plugin name (`command-doctor`). */
export declare const name: string;

/** The services this plugin requires to be present. */
export declare const inject: string[];

/**
 * `/doctor [status|fix|restore]` - the slash command, available in any
 * session of the profile this plugin is mounted in.
 */
export declare function execute(invocation: unknown): Promise<{ kind: string; text: string }>;

/**
 * A boot-time self-check hook (reports problems into the boot log).
 * Accepts any console-like `report` object with optional `warn`/`info`.
 */
export declare function bootCheck(report?: { warn?: (msg: string) => void; info?: (msg: string) => void }): Promise<{
  ran: boolean;
  healthy: boolean;
  reason?: string;
  broken?: string[];
}>;

/** The Cordis plugin apply function. */
export declare function apply(ctx: unknown): void;
