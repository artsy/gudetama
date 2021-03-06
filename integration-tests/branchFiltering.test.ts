import { describeIntegrationTest } from './describeIntegrationTest'
import { defaultConfig } from './defaultConfig'
import { readFileSync, unlinkSync, existsSync } from 'fs-extra'
import { join } from 'path'

describeIntegrationTest(
  'current branch detection',
  ({ exec, writeConfig, gudetama, dir }) => {
    exec('git init')
    exec('git checkout -b my-special-branch')
    exec('git commit --allow-empty -m message')
    it(`picks up the current branch from git repo`, async () => {
      writeConfig({
        ...defaultConfig,
        steps: {
          'write-artifact': {
            command: 'echo "I am the artifact" > artifact.txt',
            branches: {
              only: ['my-special-branch'],
            },
          },
        },
      })
      expect(exec(`${gudetama} run-if-needed write-artifact`)).not.toMatch(
        "Skipping 'write-artifact'"
      )
      expect(readFileSync(join(dir, 'artifact.txt')).toString()).toBe(
        'I am the artifact\n'
      )
      unlinkSync(join(dir, 'artifact.txt'))
      exec('git checkout -b a-different-branch')
      expect(exec(`${gudetama} run-if-needed write-artifact`)).toMatch(
        "Skipping 'write-artifact' because this is the a-different-branch branch"
      )
    })

    it(`can override current branch in config`, async () => {
      writeConfig({
        ...defaultConfig,
        currentBranch: 'overridden-branch',
        steps: {
          'write-artifact': {
            command: 'echo "I am the artifact" > artifact.txt',
            branches: {
              only: ['my-special-branch'],
            },
          },
        },
      })
      expect(exec(`${gudetama} run-if-needed write-artifact`)).toMatch(
        "Skipping 'write-artifact' because this is the overridden-branch branch"
      )
    })
  }
)

describeIntegrationTest(
  'the only branch filter option',
  ({ exec, dir, gudetama, writeConfig }) => {
    exec('git init')
    exec('git commit --allow-empty -m initial')

    it(`only runs on the specified branch`, async () => {
      expect(exec('git rev-parse --abbrev-ref HEAD')).toBe('master')
      writeConfig({
        ...defaultConfig,
        steps: {
          'only-on-beta': {
            command: 'touch ran.txt',
            branches: {
              only: ['beta'],
            },
          },
        },
      })
      exec(`${gudetama} run-if-needed only-on-beta`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeFalsy()
      exec('git checkout -b not-beta')
      exec(`${gudetama} run-if-needed only-on-beta`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeFalsy()
      exec('git checkout -b beta')
      exec(`${gudetama} run-if-needed only-on-beta`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeTruthy()
    })
  }
)

describeIntegrationTest(
  'the never branch filter option',
  ({ exec, dir, gudetama, writeConfig }) => {
    exec('git init')
    exec('git commit --allow-empty -m initial')

    it(`never runs on the specified branch`, async () => {
      expect(exec('git rev-parse --abbrev-ref HEAD')).toBe('master')
      writeConfig({
        ...defaultConfig,
        steps: {
          'never-on-beta': {
            command: 'touch ran.txt',
            branches: {
              never: ['beta'],
            },
          },
        },
      })
      expect(existsSync(join(dir, 'ran.txt'))).toBeFalsy()

      exec(`${gudetama} run-if-needed never-on-beta`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeTruthy()
      unlinkSync(join(dir, 'ran.txt'))

      exec('git checkout -b not-beta')
      exec(`${gudetama} run-if-needed never-on-beta`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeTruthy()
      unlinkSync(join(dir, 'ran.txt'))

      exec('git checkout -b beta')
      expect(existsSync(join(dir, 'ran.txt'))).toBeFalsy()
      exec(`${gudetama} run-if-needed never-on-beta`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeFalsy()
    })
  }
)

describeIntegrationTest(
  'the always branch filter option',
  ({ exec, dir, gudetama, writeConfig }) => {
    exec('git init')
    exec('git commit --allow-empty -m initial')

    it(`is runs every time on that branch, even if nothing changed`, async () => {
      exec('echo hello_1 > input.txt')
      writeConfig({
        ...defaultConfig,
        steps: {
          'run-tests': {
            command: 'touch ran.txt',
            inputs: {
              files: {
                include: ['input.txt'],
              },
            },
            branches: {
              always: ['beta'],
            },
          },
        },
      })
      expect(existsSync(join(dir, 'ran.txt'))).toBeFalsy()
      exec(`${gudetama} run-if-needed run-tests`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeTruthy()
      exec('rm ran.txt')

      // input didn't change so should not run
      exec(`${gudetama} run-if-needed run-tests`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeFalsy()

      exec('echo hello_2 > input.txt')
      exec(`${gudetama} run-if-needed run-tests`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeTruthy()
      exec('rm ran.txt')

      exec('git checkout -b beta')

      expect(existsSync(join(dir, 'ran.txt'))).toBeFalsy()
      exec(`${gudetama} run-if-needed run-tests`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeTruthy()
      exec('rm ran.txt')

      // input didn't change but should run anyway because we're on the beta branch
      exec(`${gudetama} run-if-needed run-tests`)
      expect(existsSync(join(dir, 'ran.txt'))).toBeTruthy()
    })
  }
)
