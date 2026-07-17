import {
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({ region: "ap-south-2" });
const BUCKET_NAME = "polygon-giro3d";

export const handler = async (event) => {
    try {
        const method = event.requestContext.http.method;

        // Handle CORS preflight
        if (method === "OPTIONS") {
            return {
                statusCode: 200,
                headers: getCorsHeaders()
            };
        }

        // ==========================
        // GET REQUEST
        // ==========================
        if (method === "GET") {
            const projectId = event.queryStringParameters?.projectId;
            const surveyId = event.queryStringParameters?.surveyId;
            const type = event.queryStringParameters?.type;

            if (!projectId || !surveyId || !type) {
                return {
                    statusCode: 400,
                    headers: getCorsHeaders(),
                    body: "Missing parameters"
                };
            }

            const prefix = `projects/${projectId}/surveys/${surveyId}/reports/${type}/`;

            const command = new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: prefix
            });

            const response = await s3Client.send(command);

            const files = (response.Contents || [])
                .map(item => {
                    const url = `https://${BUCKET_NAME}.s3.ap-south-2.amazonaws.com/${item.Key}`;
                    const fileName = item.Key.replace(prefix, "");

                    return {
                        fileName,
                        url,
                        lastModified: item.LastModified
                    };
                })
                .filter(item => item.fileName !== "");

            return {
                statusCode: 200,
                headers: getCorsHeaders(),
                body: JSON.stringify(files)
            };
        }

        // ==========================
        // POST REQUEST
        // ==========================
        if (method === "POST") {
            const body = JSON.parse(event.body);

            const {
                projectId,
                surveyId,
                fileName,
                type
            } = body;

            if (!projectId || !surveyId || !fileName || !type) {
                return {
                    statusCode: 400,
                    headers: getCorsHeaders(),
                    body: "Missing parameters"
                };
            }

            const s3Key = `projects/${projectId}/surveys/${surveyId}/reports/${type}/${fileName}`;

            const contentType = fileName.endsWith(".json")
                ? "application/json"
                : "application/pdf";

            const command = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                ContentType: contentType
            });

            const uploadUrl = await getSignedUrl(s3Client, command, {
                expiresIn: 60
            });

            return {
                statusCode: 200,
                headers: getCorsHeaders(),
                body: JSON.stringify({
                    uploadUrl,
                    s3Key
                })
            };
        }

        // ==========================
        // DELETE REQUEST
        // ==========================
        if (method === "DELETE") {
            const body = JSON.parse(event.body);

            const {
                projectId,
                surveyId,
                fileName,
                type
            } = body;

            if (!projectId || !surveyId || !fileName || !type) {
                return {
                    statusCode: 400,
                    headers: getCorsHeaders(),
                    body: "Missing parameters"
                };
            }

            const s3Key = `projects/${projectId}/surveys/${surveyId}/reports/${type}/${fileName}`;

            const command = new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key
            });

            await s3Client.send(command);

            return {
                statusCode: 200,
                headers: getCorsHeaders(),
                body: JSON.stringify({
                    success: true
                })
            };
        }

        return {
            statusCode: 405,
            headers: getCorsHeaders(),
            body: "Method Not Allowed"
        };

    } catch (error) {
        console.error("Error:", error);

        return {
            statusCode: 500,
            headers: getCorsHeaders(),
            body: JSON.stringify({
                error: error.message
            })
        };
    }
};

function getCorsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET,DELETE"
    };
}
