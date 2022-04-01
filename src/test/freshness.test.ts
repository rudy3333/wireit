/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as pathlib from 'path';
import {suite} from 'uvu';
import * as assert from 'uvu/assert';
import {timeout} from './util/uvu-timeout.js';
import {WireitTestRig} from './util/test-rig.js';
import {shuffle} from '../util/shuffle.js';

const test = suite<{rig: WireitTestRig}>();

test.before.each(async (ctx) => {
  try {
    ctx.rig = new WireitTestRig();
    await ctx.rig.setup();
  } catch (error) {
    // Uvu has a bug where it silently ignores failures in before and after,
    // see https://github.com/lukeed/uvu/issues/191.
    console.error('uvu before error', error);
    process.exit(1);
  }
});

test.after.each(async (ctx) => {
  try {
    await ctx.rig.cleanup();
  } catch (error) {
    // Uvu has a bug where it silently ignores failures in before and after,
    // see https://github.com/lukeed/uvu/issues/191.
    console.error('uvu after error', error);
    process.exit(1);
  }
});

test(
  'fresh script is skipped',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['input.txt'],
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // No input file changed, so script is fresh, and command is not invoked.
    {
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }
  })
);

test(
  'changing input file makes script stale',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['input.txt'],
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Input file changed, so script is stale, and command is invoked.
    {
      await rig.write({
        'input.txt': 'v1',
      });
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
    }
  })
);

test(
  'changing input file modtime does not make script stale',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['input.txt'],
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Input file is written to the same value, so its modtime changed, but
    // since the content is the same, the script is still fresh, and the command
    // is not invoked.
    {
      await rig.write({
        'input.txt': 'v0',
      });
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }
  })
);

test(
  'script with undefined input files is always stale',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // No input file changed, but input files are undefined, so script is still
    // stale, and command is invoked.
    {
      await rig.write({
        'input.txt': 'v1',
      });
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
    }
  })
);

test(
  'script with undefined input files and undefined command can be fresh',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    const cmdC = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
          b: 'wireit',
          c: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: [],
            dependencies: ['b'],
          },
          b: {
            // B has undefined input files, but it can still have a cache key,
            // because it has no command. In effect, it is just an alias for C,
            // which does have its files defined.
            dependencies: ['c'],
          },
          c: {
            command: cmdC.command,
            files: [],
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so commands are invoked.
    {
      const exec = rig.exec('npm run a');
      const invC = await cmdC.nextInvocation();
      invC.exit(0);
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
      assert.equal(cmdC.numInvocations, 1);
    }

    // No input files changed, so no commands are invoked. It doesn't matter
    // that B has undefined input files, because it has an undefined command
    // too.
    {
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
      assert.equal(cmdC.numInvocations, 1);
    }
  })
);

test(
  'script with empty input files can be fresh',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: [],
          },
        },
      },
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // No input file changed, so script is fresh, and command is not invoked.
    {
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }
  })
);

test(
  'empty directory is not included in cache key',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['input/**'],
          },
        },
      },
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Empty directory created, but that doesn't count as an input file, so
    // script is still fresh.
    {
      await rig.mkdir('input/subdir');
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }
  })
);

test(
  'cross-package freshness is tracked',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    const cmdB = await rig.newCommand();
    await rig.write({
      'foo/package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            dependencies: ['../bar:b'],
            files: ['input.txt'],
          },
        },
      },
      'foo/input.txt': 'v0',
      'bar/package.json': {
        scripts: {
          b: 'wireit',
        },
        wireit: {
          b: {
            command: cmdB.command,
            files: ['input.txt'],
          },
        },
      },
      'bar/input.txt': 'v0',
    });

    // Initially stale, so both commands run.
    {
      const exec = rig.exec('npm run a', {cwd: 'foo'});
      const invB = await cmdB.nextInvocation();
      invB.exit(0);
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
      assert.equal(cmdB.numInvocations, 1);
    }

    // Nothing changed, so neither runs.
    {
      const exec = rig.exec('npm run a', {cwd: 'foo'});
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
      assert.equal(cmdB.numInvocations, 1);
    }

    // Change A input file, so only A runs.
    {
      await rig.write({
        'foo/input.txt': 'v1',
      });
      const exec = rig.exec('npm run a', {cwd: 'foo'});
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
      assert.equal(cmdB.numInvocations, 1);
    }

    // Change B input file, so both run.
    {
      await rig.write({
        'bar/input.txt': 'v1',
      });
      const exec = rig.exec('npm run a', {cwd: 'foo'});
      const invB = await cmdB.nextInvocation();
      invB.exit(0);
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 3);
      assert.equal(cmdB.numInvocations, 2);
    }
  })
);

test(
  'input file can be outside of package',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'foo/package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['../outside.txt'],
          },
        },
      },
      'outside.txt': 'v0',
    });

    // Initially stale, so command runs.
    {
      const exec = rig.exec('npm run a', {cwd: 'foo'});
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Nothing changed, so doesn't run.
    {
      const exec = rig.exec('npm run a', {cwd: 'foo'});
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Input file changed, so command runs.
    {
      await rig.write({
        'outside.txt': 'v1',
      });
      const exec = rig.exec('npm run a', {cwd: 'foo'});
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
    }
  })
);

test(
  'two commands which reference the same input file',
  timeout(async ({rig}) => {
    const cmdB = await rig.newCommand();
    const cmdC = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
          b: 'wireit',
          c: 'wireit',
        },
        wireit: {
          a: {
            dependencies: ['b', 'c'],
          },
          b: {
            command: cmdB.command,
            files: ['input.txt'],
          },
          c: {
            command: cmdC.command,
            files: ['input.txt'],
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so commands run.
    {
      const exec = rig.exec('npm run a');
      const invB = await cmdB.nextInvocation();
      const invC = await cmdC.nextInvocation();
      invB.exit(0);
      invC.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdB.numInvocations, 1);
      assert.equal(cmdC.numInvocations, 1);
    }

    // Nothing changed, so nothing runs.
    {
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdB.numInvocations, 1);
      assert.equal(cmdC.numInvocations, 1);
    }

    // Input file changed. Since it is an input to both B and C, they both run.
    {
      await rig.write({
        'input.txt': 'v1',
      });
      const exec = rig.exec('npm run a');
      const invB = await cmdB.nextInvocation();
      const invC = await cmdC.nextInvocation();
      invB.exit(0);
      invC.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdB.numInvocations, 2);
      assert.equal(cmdC.numInvocations, 2);
    }
  })
);

test(
  'glob recursive stars (**) match input files',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['src/**/*.txt'],
          },
        },
      },
      'src/foo/bar/input.txt': 'v0',
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Input file changed, so script is stale, and command is invoked.
    {
      await rig.write({
        'src/foo/bar/input.txt': 'v1',
      });
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
    }
  })
);

test(
  'glob negations (!) exclude input files',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['src/*.txt', '!src/excluded.txt'],
          },
        },
      },
      'src/included.txt': 'v0',
      'src/excluded.txt': 'v0',
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // An excluded file changed, so script is fresh, and command is not invoked.
    {
      await rig.write({
        'src/excluded.txt': 'v1',
      });
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // An included file changed, so script is stale, and command is invoked.
    {
      await rig.write({
        'src/included.txt': 'v1',
      });
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
    }
  })
);

test(
  'fresh script is skipped with unsafe characters in script name',
  timeout(async ({rig}) => {
    // This test confirms that we are serializing the previous state in a way
    // that doesn't try to put forbidden characters in filenames (as would be
    // the case if we used the script name directly).
    const name = '🔥<>:/\\|?*';

    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          [name]: 'wireit',
        },
        wireit: {
          [name]: {
            command: cmdA.command,
            files: ['input.txt'],
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec(`npm run "${name}"`);
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Check that we created a state file using the hex encoding of the script
    // name.
    assert.ok(
      await rig.exists(
        pathlib.join(
          '.wireit',
          // Buffer.from(name).toString('hex')
          'f09f94a53c3e3a2f5c7c3f2a',
          'state'
        )
      )
    );

    // No input file changed, so script is fresh, and command is not invoked.
    {
      const exec = rig.exec(`npm run "${name}"`);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }
  })
);

test(
  'failure makes script stale',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['input.txt'],
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so command is invoked, and it fails.
    {
      const exec = rig.exec(`npm run a`);
      const inv = await cmdA.nextInvocation();
      inv.exit(2);
      const res = await exec.exit;
      assert.equal(res.code, 1);
      assert.equal(cmdA.numInvocations, 1);
    }

    // No input file changed, but previous invocation failed, so script is still
    // stale, and command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
    }
  })
);

test(
  'state is deleted before invoking command',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['input.txt'],
          },
        },
      },
      'input.txt': 'v0',
    });

    // Initially stale, so command is invoked. It succeeds, so a state file is
    // written.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Input file changed, so script is stale, and command is invoked. It fails,
    // so a state file is not written. However, before the command is invoked,
    // the previous state file must be deleted, because we can no longer be sure
    // that the previous state is still reflected in the output (this failed
    // invocation could have written some output before failing).
    {
      await rig.write({
        'input.txt': 'v1',
      });
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(1);
      const res = await exec.exit;
      assert.equal(res.code, 1);
      assert.equal(cmdA.numInvocations, 2);
    }

    // Input file reverts back to v0. Since the previous state file was deleted,
    // the script is stale, and command is invoked. If we didn't pre-emptively
    // delete the state file in the previous step, we would wrongly think we
    // were fresh.
    {
      await rig.write({
        'input.txt': 'v0',
      });
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 3);
    }
  })
);

test(
  'script is stale if a dependency was stale',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    const cmdB = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
          b: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            dependencies: ['b'],
            files: ['a.txt'],
          },
          b: {
            command: cmdB.command,
            files: ['b.txt'],
          },
        },
      },
      'a.txt': 'v0',
      'b.txt': 'v0',
    });

    // Initially stale.
    {
      const exec = rig.exec('npm run a');
      const invB = await cmdB.nextInvocation();
      invB.exit(0);
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
      assert.equal(cmdB.numInvocations, 1);
    }

    // Input to B changed, so both A and B are stale.
    {
      await rig.write({'b.txt': 'v1'});
      const exec = rig.exec('npm run a');
      const invB = await cmdB.nextInvocation();
      invB.exit(0);
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
      assert.equal(cmdB.numInvocations, 2);
    }

    // Input to A changed, so only A is stale.
    {
      await rig.write({'a.txt': 'v1'});
      const exec = rig.exec('npm run a');
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 3);
      assert.equal(cmdB.numInvocations, 2);
    }

    // No input changed, so both A and B are fresh.
    {
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 3);
      assert.equal(cmdB.numInvocations, 2);
    }
  })
);

test(
  'script is always stale if a dependency has no input files',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    const cmdB = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
          b: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['a.txt'],
            dependencies: ['b'],
          },
          b: {
            command: cmdB.command,
          },
        },
      },
      'a.txt': 'v0',
    });

    // Initially stale.
    {
      const exec = rig.exec('npm run a');
      const invB = await cmdB.nextInvocation();
      invB.exit(0);
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
      assert.equal(cmdB.numInvocations, 1);
    }

    // No inputs changed, but both A and B are still stale, because B has
    // unknown input files.
    {
      const exec = rig.exec('npm run a');
      const invB = await cmdB.nextInvocation();
      invB.exit(0);
      const invA = await cmdA.nextInvocation();
      invA.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
      assert.equal(cmdB.numInvocations, 2);
    }
  })
);

test(
  'changing script command makes script stale',
  timeout(async ({rig}) => {
    const cmdA1 = await rig.newCommand();
    const cmdA2 = await rig.newCommand();

    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA1.command,
            files: ['a.txt'],
          },
        },
      },
      'a.txt': 'v0',
    });

    // Initially stale.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA1.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA1.numInvocations, 1);
      assert.equal(cmdA2.numInvocations, 0);
    }

    // Change the command.
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA2.command,
            files: ['a.txt'],
          },
        },
      },
    });

    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA2.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA1.numInvocations, 1);
      assert.equal(cmdA2.numInvocations, 1);
    }
  })
);

test(
  'changing output glob patterns makes script stale',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();

    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['a.txt'],
            output: ['foo'],
          },
        },
      },
      'a.txt': 'v0',
    });

    // Initially stale.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Change the output setting.
    {
      await rig.write({
        'package.json': {
          scripts: {
            a: 'wireit',
          },
          wireit: {
            a: {
              command: cmdA.command,
              files: ['a.txt'],
              output: ['bar'],
            },
          },
        },
      });
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
    }
  })
);

test(
  'changing clean setting makes script stale',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();

    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['a.txt'],
          },
        },
      },
      'a.txt': 'v0',
    });

    // Initially stale.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Change the clean setting.
    {
      await rig.write({
        'package.json': {
          scripts: {
            a: 'wireit',
          },
          wireit: {
            a: {
              command: cmdA.command,
              files: ['a.txt'],
              clean: false,
            },
          },
        },
      });
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 2);
    }
  })
);

test(
  'cache key is independent of file ordering',
  timeout(async ({rig}) => {
    const cmdA = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['input/a', 'input/b'],
          },
        },
      },
      'input/a': 'v0',
      'input/b': 'v0',
    });

    // Initially stale, so command is invoked.
    {
      const exec = rig.exec('npm run a');
      const inv = await cmdA.nextInvocation();
      inv.exit(0);
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }

    // Change the order of files
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            files: ['input/b', 'input/a'],
          },
        },
      },
    });

    // No input files changed, even though the order did, so the script is still
    // fresh.
    {
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
    }
  })
);

test(
  'cache key is independent of dependency ordering',
  timeout(async ({rig}) => {
    //         a
    //         |
    //    +-+--+--+-+
    //   /  |  |  |  \
    //   v  v  v  v  v
    //   b  c  d  e  f
    const cmdA = await rig.newCommand();
    const cmdB = await rig.newCommand();
    const cmdC = await rig.newCommand();
    const cmdD = await rig.newCommand();
    const cmdE = await rig.newCommand();
    const cmdF = await rig.newCommand();
    await rig.write({
      'package.json': {
        scripts: {
          a: 'wireit',
          b: 'wireit',
          c: 'wireit',
          d: 'wireit',
          e: 'wireit',
          f: 'wireit',
        },
        wireit: {
          a: {
            command: cmdA.command,
            dependencies: ['b', 'c', 'd', 'e', 'f'],
            files: ['a.txt'],
          },
          b: {
            command: cmdB.command,
            files: ['b.txt'],
          },
          c: {
            command: cmdC.command,
            files: ['c.txt'],
          },
          d: {
            command: cmdD.command,
            files: ['d.txt'],
          },
          e: {
            command: cmdE.command,
            files: ['e.txt'],
          },
          f: {
            command: cmdF.command,
            files: ['f.txt'],
          },
        },
      },
      'a.txt': 'v0',
      'b.txt': 'v0',
      'c.txt': 'v0',
      'd.txt': 'v0',
      'e.txt': 'v0',
      'f.txt': 'v0',
    });

    // Initially stale, so commands are invoked.
    {
      const exec = rig.exec('npm run a');

      // Commands are started in a random order. Have them finish in a
      // (differently) random order too.
      const commands = [cmdB, cmdC, cmdD, cmdE, cmdF];
      shuffle(commands);
      for (const cmd of commands) {
        const inv = await cmd.nextInvocation();
        inv.exit(0);
      }

      const invA = await cmdA.nextInvocation();
      invA.exit(0);

      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
      assert.equal(cmdB.numInvocations, 1);
      assert.equal(cmdC.numInvocations, 1);
      assert.equal(cmdD.numInvocations, 1);
      assert.equal(cmdE.numInvocations, 1);
      assert.equal(cmdF.numInvocations, 1);
    }

    // No input files changed, so all commands are still fresh.
    {
      const exec = rig.exec('npm run a');
      const res = await exec.exit;
      assert.equal(res.code, 0);
      assert.equal(cmdA.numInvocations, 1);
      assert.equal(cmdB.numInvocations, 1);
      assert.equal(cmdC.numInvocations, 1);
      assert.equal(cmdD.numInvocations, 1);
      assert.equal(cmdE.numInvocations, 1);
      assert.equal(cmdF.numInvocations, 1);
    }
  })
);

test.run();