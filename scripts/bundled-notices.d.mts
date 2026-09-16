import type { Plugin } from 'vite';

interface NoticeManifest {
  schemaVersion: 1;
  buildScopes: string[];
  packages: {
    name: string;
    version: string;
    license: string;
    licenses: { file: string; text: string; source?: string }[];
    outputs: string[];
  }[];
}

export function createBundledNotices(options?: { root?: string }): {
  plugin(scope: 'app' | 'worker' | 'service-worker'): Plugin;
};

export function renderBundledNotices(manifest: NoticeManifest): string;
export function bundledNoticeFailures(
  value: unknown,
  text: string,
  packagePaths: Set<string>,
): string[];
