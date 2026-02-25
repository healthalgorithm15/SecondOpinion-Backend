// const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'); // Uncomment for AWS
// const { v4: uuidv4 } = require('uuid'); // Uncomment for AWS

exports.uploadFile = async (file) => {
  // 1. AWS S3 PRODUCTION PATH (Commented out for now)
  if (process.env.STORAGE_MODE === 'AWS') {
    /* const s3 = new S3Client({ region: process.env.AWS_REGION });
    const key = `records/${Date.now()}-${file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    }));
    return { mode: 'AWS', url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${key}` };
    */
  }

  // 2. LOCAL DEVELOPMENT PATH (MongoDB Buffer)
  return {
    mode: 'LOCAL',
    buffer: file.buffer,
    mimetype: file.mimetype
  };
};