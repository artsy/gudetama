import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import slugify from '@sindresorhus/slugify'
import { log } from './log'
import { S3StoreBackend } from './store/S3StoreBackend'
import { hashString } from './manifest/hash'
import stableStringify from 'fast-json-stable-stringify'

import type { ConfigFile } from '@artsy/gudetama'
import { FSBackend } from './store/FSBackend'

import isCi from 'is-ci'
import { gray } from 'kleur'

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
  } catch (e) {
    console.error(
      `Can't get name of current git branch. Check that you're in a git repo.`
    )
    process.exit(1)
  }
}

function checkStepNamesDontClash(config: ConfigFile) {
  const keys = new Map<String, String>()
  for (const key of Object.keys(config.steps)) {
    const slug = slugify(key)
    if (keys.has(slug)) {
      log.fail(
        `Step names '${key}' and '${keys.get(
          slug
        )}' are too similar. They both become '${slug}' when slugified.`
      )
    } else {
      keys.set(slug, key)
    }
  }
}

function loadConfig(): Required<ConfigFile> {
  const file = process.env.GUDETAMA_CONFIG_PATH || './gudetama.config.js'
  if (!fs.existsSync(file)) {
    log.fail(`Can't find gudetama config file at '${file}'`)
  }

  const userConfig = require(path.join(process.cwd(), file)) as ConfigFile

  const config = {
    currentBranch:
      userConfig.currentBranch ||
      process.env.CIRCLE_BRANCH ||
      process.env.TRAVIS_BRANCH ||
      getCurrentBranch(),
    primaryBranch: userConfig.primaryBranch || 'master',
    manifestDir: '.gudetama-manifests',
    getCacheBackend() {
      return isCi ? new S3StoreBackend() : new FSBackend()
    },
    ...userConfig,
  }

  checkStepNamesDontClash(config)

  return config
}

export const config = loadConfig()

export function getStep({ stepName }: { stepName: string }) {
  return config.steps[stepName] ?? log.fail(`No step called '${stepName}'`)
}

export function getArchivePaths({ stepName }: { stepName: string }) {
  const step = getStep({ stepName })

  const persistentCachePaths: string[] = []
  const cachePaths: string[] = []
  const artifactPaths: string[] = []

  step.outputFiles?.forEach((path) => {
    if (step.caches?.includes(path)) {
      persistentCachePaths.push(path)
    } else {
      artifactPaths.push(path)
    }
  })

  step.caches?.forEach((path) => {
    if (!persistentCachePaths.includes(path)) {
      cachePaths.push(path)
    }
  })

  return { persistentCachePaths, cachePaths, artifactPaths }
}

export function getStepKey({ stepName }: { stepName: string }) {
  const step = getStep({ stepName })
  const slug = slugify(stepName)
  const stepHash = hashString(stableStringify(step))
  return [config.repoID, config.cacheVersion, slug, stepHash].join('-')
}

export function getManifestPath({ stepName }: { stepName: string }) {
  return path.join(config.manifestDir, slugify(stepName))
}

export function shouldRunStepOnCurrentBranch({
  stepName,
}: {
  stepName: string
}): 'maybe' | 'no' | 'always' {
  const step = getStep({ stepName })
  if (
    step.branches?.never?.includes(config.currentBranch) ||
    (step.branches?.only && !step.branches.only.includes(config.currentBranch))
  ) {
    return 'no'
  }

  if (step.branches?.always?.includes(config.currentBranch)) {
    return 'always'
  }

  return 'maybe'
}

export const renderStepName = ({ stepName }: { stepName: string }) =>
  `${gray("'")}${stepName}${gray("'")}`
