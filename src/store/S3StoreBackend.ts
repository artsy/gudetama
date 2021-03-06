import fs from 'fs'
import https from 'https'
import { hashFile } from '../manifest/hash'
import { log } from '../log'
import type { CacheBackend } from '@artsy/gudetama'
import { sign } from 'aws4'
import { red } from 'kleur'
import { encode } from 'querystring'
import { parseXML } from './parseXML'

export interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  region: string
}

export class S3StoreBackend implements CacheBackend {
  constructor(public config: S3Config = defaultConfig) {
    if (Object.values(config).some((x) => !x)) {
      log.fail('S3 config vars not found')
    }
  }

  signedRequest(props: {
    method: 'GET' | 'PUT' | 'DELETE'
    path: string
    headers: object
  }) {
    return https.request(
      sign(
        {
          ...props,
          host: `${this.config.bucket}.s3.amazonaws.com`,
          region: this.config.region,
          service: 's3',
        },
        this.config
      )
    )
  }

  async getObject(objectKey: string, destinationPath: string) {
    const req = this.signedRequest({
      method: 'GET',
      path: `/${objectKey}`,
      headers: {
        Aceept: 'application/octet-stream',
        'x-amz-content-sha256':
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
    })

    return new Promise<boolean>((resolve, reject) => {
      req.on('response', (res) => {
        const fh = fs.openSync(destinationPath, 'w')
        let totalBytesWritten = 0
        res.on('data', (d: Buffer) => {
          fs.writeSync(fh, d, 0, d.length, totalBytesWritten)
          totalBytesWritten += d.length
        })
        res.on('end', () => {
          fs.closeSync(fh)
          switch (res.statusCode) {
            case 404:
              resolve(false)
              break
            case 200:
              resolve(true)
              break
            default:
              console.error(
                `aws s3 GET Request failed with status code ${res.statusCode}: ${res.statusMessage}`
              )
              console.error(
                `\n${red(fs.readFileSync(destinationPath).toString())}\n`
              )
              fs.unlinkSync(destinationPath)
              console.error(
                `aws s3 GET Request failed with status code ${res.statusCode}: ${res.statusMessage}`
              )
              process.exit(1)
          }
        })
        res.on('error', reject)
      })

      req.end()
    })
  }
  async putObject(objectKey: string, sourcePath: string) {
    const contentHash = hashFile(sourcePath)

    const req = this.signedRequest({
      method: 'PUT',
      path: `/${objectKey}`,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fs.statSync(sourcePath).size,
        'x-amz-content-sha256': contentHash,
      },
    })

    fs.createReadStream(sourcePath).pipe(req)

    return new Promise<void>((resolve, reject) => {
      req.on('response', (res) => {
        const bufs: Buffer[] = []
        res.on('data', function (d) {
          bufs.push(d)
        })
        res.on('end', function () {
          if (res.statusCode! !== 200) {
            console.error(
              `aws s3 PUT Request failed with status code ${res.statusCode}: ${res.statusMessage}`
            )

            const buf = Buffer.concat(bufs)
            console.error(`\n${red(buf.toString())}\n`)

            console.error(
              `aws s3 PUT Request failed with status code ${res.statusCode}: ${res.statusMessage}`
            )
            process.exit(1)
          }
          resolve()
        })
        res.on('error', reject)
      })
    })
  }

  async listAllObjects(
    continuationToken?: string
  ): Promise<Array<{ key: string; size: number }>> {
    const result: Array<{ key: string; size: number }> = []
    const req = this.signedRequest({
      method: 'GET',
      path:
        `/?list-type=2&` +
        encode({
          'max-keys': 1000,
          ...(continuationToken
            ? { 'continuation-token': continuationToken }
            : {}),
        }),
      headers: {
        'x-amz-request-payer': 'requester',
      },
    })

    let body = ''

    await new Promise((resolve, reject) => {
      req.on('error', reject)
      req.on('response', (res) => {
        res.on('error', reject)

        res.on('data', (buf) => {
          body += buf.toString()
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            log.fail('Error listing objects. Http code: ' + res.statusCode, {
              detail: body,
            })
          } else {
            resolve()
          }
        })
      })
      req.end()
    })

    interface Content {
      Key: string
      Size: string
    }

    interface Response {
      Contents: Content[]
      NextContinuationToken?: string
    }

    const response: Response = await parseXML(body)

    for (const { Key, Size } of response.Contents) {
      result.push({ key: Key, size: Number(Size) })
    }

    if (response.NextContinuationToken) {
      return [
        ...result,
        ...(await this.listAllObjects(response.NextContinuationToken)),
      ]
    }

    return result
  }

  async deleteObject(objectKey: string) {
    const req = this.signedRequest({
      method: 'DELETE',
      path: `/${objectKey}`,
      headers: {
        'x-amz-request-payer': 'requester',
      },
    })

    await new Promise((resolve, reject) => {
      req.on('error', reject)
      req.on('response', (res) => {
        res.on('error', reject)
        if (res.statusCode! >= 300) {
          log.fail(`Couldn't delete object, got status ${res.statusCode}`)
        } else {
          resolve()
        }
      })
      req.end()
    })
  }
}

const defaultConfig: S3Config = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  bucket: process.env.GUDETAMA_S3_BUCKET_NAME || '',
  region: process.env.GUDETAMA_S3_REGION || 'us-east-1',
}
