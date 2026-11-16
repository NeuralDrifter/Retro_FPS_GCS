/**
 * The license and notice files every export ships (release plan P3.5): `THIRD_PARTY_NOTICES.txt`
 * for the software the runtime includes (three.js always, the Draco decoder only when it ships),
 * `LICENSE-runtime.txt` for the runtime itself, and `README.txt` on publishing the game. Line
 * endings are normalised so a checkout with CRLF files still gives the same zip bytes.
 */
import runtimeLicense from '../../LICENSE?raw';
import apacheLicense from './templates/notices/apache-2.0.txt?raw';
import threeLicense from './templates/notices/three-mit.txt?raw';
import readmeTemplate from './templates/README.txt?raw';

const lf = (text: string) => `${text.replace(/\r\n?/g, '\n').trimEnd()}\n`;

const RULE = '='.repeat(72);

/** `THIRD_PARTY_NOTICES.txt`; `runtimeFile` is the runtime's file name, e.g. `game.<hash>.js` */
export function renderThirdPartyNotices(options: { runtimeFile: string; draco: boolean }): string {
  const sections = [
    [
      'Retro FPS GCS game runtime',
      `Used in: ${options.runtimeFile}`,
      'License: MIT (the full text is in LICENSE-runtime.txt)',
    ].join('\n'),
    [
      'three.js',
      `Used in: ${options.runtimeFile}`,
      'Source: https://github.com/mrdoob/three.js',
      'License: MIT',
      '',
      lf(threeLicense).trimEnd(),
    ].join('\n'),
  ];
  if (options.draco) {
    sections.push(
      [
        'Draco 3D data compression (decoder)',
        'Used in: draco/',
        'Source: https://github.com/google/draco',
        'Copyright The Draco Authors.',
        'License: Apache License 2.0',
        '',
        lf(apacheLicense).trimEnd(),
      ].join('\n')
    );
  }
  const intro = 'This game includes the following software. Each part keeps its own license.';
  return lf([intro, ...sections.map((s) => `${RULE}\n${s}`)].join('\n\n'));
}

/** `LICENSE-runtime.txt`: the runtime's MIT license, the same text as the editor's LICENSE */
export function renderRuntimeLicense(): string {
  return lf(runtimeLicense);
}

/** `README.txt` for a game called `title` */
export function renderReadme(title: string): string {
  // A function replacement, so `$&` and the like in a title stay literal
  return lf(readmeTemplate.replace(/\{\{TITLE\}\}/g, () => title));
}
