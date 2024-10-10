const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Configure AWS SDK
AWS.config.update({ region: process.env.AWS_REGION });
const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

async function uploadToS3(bucketName, sourceDir, destDir = '') {
  const files = fs.readdirSync(sourceDir);

  for (const file of files) {
    const filePath = path.join(sourceDir, file);
    const key = path.join(destDir, file);

    if (fs.statSync(filePath).isDirectory()) {
      await uploadToS3(bucketName, filePath, key);
    } else {
      const fileContent = fs.readFileSync(filePath);
      await s3.putObject({
        Bucket: bucketName,
        Key: key,
        Body: fileContent,
        ContentType: getContentType(file),
      }).promise();
    }
  }
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html';
    case '.css': return 'text/css';
    case '.js': return 'application/javascript';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

async function invalidateCloudFront(distributionId, paths) {
  await cloudfront.createInvalidation({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: Date.now().toString(),
      Paths: {
        Quantity: paths.length,
        Items: paths,
      },
    },
  }).promise();
}

async function publishToSite(site, sourceDir, targetDir = '') {
  const bucketName = process.env.DOCS_S3_BUCKET;
  let distributionId, siteDir;

  if (site === 'dnsdist.org') {
    distributionId = process.env.DNSDIST_CLOUDFRONT_DISTRIBUTION_ID;
    siteDir = 'dnsdist.org';
  } else if (site === 'docs.powerdns.com') {
    distributionId = process.env.DOCS_CLOUDFRONT_DISTRIBUTION_ID;
    siteDir = 'docs.powerdns.com';
  } else {
    throw new Error('Invalid site specified');
  }

  const fullTargetDir = path.join(siteDir, targetDir);
  await uploadToS3(bucketName, sourceDir, fullTargetDir);

  // Invalidate CloudFront cache
  await invalidateCloudFront(distributionId, ['/*']);

  console.log(`Published from ${sourceDir} to ${site}${targetDir ? '/' + targetDir : ''}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'publish') {
    if (args.length < 3 || args.length > 4) {
      console.log('Usage: node publish.js publish <SITE> <SOURCE_DIR> [TARGET_DIR]');
      return;
    }
    const [, site, sourceDir, targetDir] = args;
    await publishToSite(site, sourceDir, targetDir);
  } else {
    console.log('Usage: node publish.js publish <SITE> <SOURCE_DIR> [TARGET_DIR]');
  }
}

main().catch(console.error);
