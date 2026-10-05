/**
 * Ambient declarations for the Nitro runtime globals used by this module's
 * server plugin. They are supplied by the generated server bundle at runtime;
 * declaring them here keeps `vue-tsc` working without adding `nitropack` as a
 * direct dependency.
 *
 * Intentionally a global script (no top-level import/export) so the
 * declarations apply project-wide.
 */

declare function defineNitroPlugin(
  plugin: (nitroApp: unknown) => void,
): void

declare function useRuntimeConfig(event?: unknown): Record<string, unknown>
