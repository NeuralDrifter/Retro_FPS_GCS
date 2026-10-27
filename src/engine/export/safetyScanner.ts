/**
 * ============================================================================
 * EXPORT SAFETY SCANNER (`/src/engine/export/safetyScanner.ts`)
 * ============================================================================
 * Scans all export payloads (files, manifest, and inlined code) for accidental
 * API keys, secrets, or environment variable credentials before allowing download.
 * If any secret pattern is detected, the export is aborted immediately.
 */

export interface SafetyScanViolation {
  file: string;
  pattern: string;
  snippet: string;
}

export interface SafetyScanResult {
  safe: boolean;
  violations: SafetyScanViolation[];
}

/**
 * Scans a text string for known secret and credential patterns.
 */
export function scanStringForSecrets(
  content: string,
  filename = 'payload'
): SafetyScanViolation[] {
  const violations: SafetyScanViolation[] = [];

  // 1. Google API Key pattern: AIza[0-9A-Za-z-_]{30,40}
  const googleKeyMatch = /AIza[0-9A-Za-z-_]{30,40}/.exec(content);
  if (googleKeyMatch) {
    violations.push({
      file: filename,
      pattern: 'Google Cloud / AI Studio API Key (AIza...)',
      snippet:
        content.substring(
          Math.max(0, googleKeyMatch.index - 8),
          googleKeyMatch.index + 22
        ) + '...',
    });
  }

  // 2. Generic secret / token assignments: apiKey = "...", secret: "...", etc.
  const secretAssignMatch =
    /(?:api_?key|secret_?key|auth_?token|gemini_api_key)\s*[:=]\s*['"]([a-zA-Z0-9_\-]{16,})['"]/i.exec(
      content
    );
  if (secretAssignMatch) {
    violations.push({
      file: filename,
      pattern: 'Hardcoded API Key / Secret Token Assignment',
      snippet: secretAssignMatch[0].substring(0, 32) + '...',
    });
  }

  // 3. OpenAI or similar bearer sk-... keys
  const skMatch = /sk-[a-zA-Z0-9]{24,}/.exec(content);
  if (skMatch) {
    violations.push({
      file: filename,
      pattern: 'Secret Key Token (sk-...)',
      snippet: skMatch[0].substring(0, 20) + '...',
    });
  }

  // 4. Injected environment variable credential values
  const envSecretMatch =
    /process\.env\.(?:[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS))\s*=\s*['"][^'"]{8,}['"]/i.exec(
      content
    );
  if (envSecretMatch) {
    violations.push({
      file: filename,
      pattern: 'Injected Environment Secret Value',
      snippet: envSecretMatch[0].substring(0, 32) + '...',
    });
  }

  return violations;
}

/**
 * Scans an entire dictionary of export files (string or byte buffers).
 */
export function scanExportPayload(
  files: Record<string, string | Uint8Array>
): SafetyScanResult {
  const violations: SafetyScanViolation[] = [];
  const textDecoder = new TextDecoder('utf-8', { fatal: false });

  for (const [filename, content] of Object.entries(files)) {
    let text: string;
    if (typeof content === 'string') {
      text = content;
    } else {
      // Decode up to first 256KB of binary content (sufficient to scan glTF JSON and headers)
      const limit = Math.min(content.length, 256 * 1024);
      text = textDecoder.decode(content.subarray(0, limit));
    }
    const found = scanStringForSecrets(text, filename);
    violations.push(...found);
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * Validates an export payload and throws an informative Error if any secret is found.
 */
export function assertExportPayloadIsSafe(
  files: Record<string, string | Uint8Array>
): void {
  const result = scanExportPayload(files);
  if (!result.safe) {
    const details = result.violations
      .map((v) => `[${v.file}] ${v.pattern}: ${v.snippet}`)
      .join('; ');
    throw new Error(
      `Security Violation: Export aborted! Potential secret or API key detected in export files: ${details}`
    );
  }
}
