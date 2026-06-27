import COS from "cos-nodejs-sdk-v5";

function getCosConfig() {
  const secretId = process.env.COS_SECRET_ID;
  const secretKey = process.env.COS_SECRET_KEY;
  const bucket = process.env.COS_BUCKET; // 形如 marketing-1250000000
  const region = process.env.COS_REGION; // 形如 ap-beijing
  if (!secretId || !secretKey || !bucket || !region) return null;
  return { secretId, secretKey, bucket, region };
}

export function isCosConfigured() {
  return getCosConfig() !== null;
}

let client: COS | null = null;

function getClient(secretId: string, secretKey: string) {
  if (!client) {
    client = new COS({ SecretId: secretId, SecretKey: secretKey });
  }
  return client;
}

// 生成带签名的临时直传/下载地址（浏览器据此直传 COS，或重定向下载）。
export function cosPresignedUrl(
  key: string,
  method: "PUT" | "GET",
  expires = 900
): Promise<string> {
  const config = getCosConfig();
  if (!config) throw new Error("COS 未配置");
  const cos = getClient(config.secretId, config.secretKey);
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      {
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
        Sign: true,
        Method: method,
        Expires: expires
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data.Url);
      }
    );
  });
}
