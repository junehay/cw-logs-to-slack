import https, { RequestOptions } from 'https';
import zlib from 'zlib';

interface CloudwatchLogsEvent {
  awslogs: { data: string };
}

interface SlackMessage {
  color: string;
  title: string;
  title_link?: string;
  text?: string;
  ts?: number;
  footer?: string;
}

interface SlackBody {
  mrkdwn: boolean;
  attachments: SlackMessage[];
}

interface GunzipUtf8Json {
  messageType: string;
  owner: string;
  logGroup: string;
  logStream: string;
  subscriptionFilters: string[];
  logEvents: { id: string; timestamp: number; message: string }[];
}

function gunzipAndDecodeAsync(gzipBufferData: Buffer): Promise<GunzipUtf8Json> {
  return new Promise((resolve, reject) => {
    zlib.gunzip(gzipBufferData, (error, data) => {
      if (error) {
        return reject(error);
      }
      const stringData = data.toString('utf-8');

      return resolve(JSON.parse(stringData));
    });
  });
}

function sendMessageToSlack(
  options: RequestOptions,
  slackBody: SlackBody
): Promise<{ status?: number; message: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      response.setEncoding('utf8');

      let responseData = '';

      response.on('data', (data) => {
        responseData += data;
      });

      response.on('end', () => {
        if (Number(response.statusCode) < 200 || Number(response.statusCode) >= 300) {
          const error = new Error(`Request failed. ${responseData}`);
          reject(error);
        } else {
          resolve({ status: response.statusCode, message: responseData });
        }
      });
    });

    request.write(JSON.stringify(slackBody));

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

export const sendMessageToSlackHandler = async (
  event: CloudwatchLogsEvent
): Promise<ReturnType<typeof sendMessageToSlack>> => {
  const EncodingEventData = event.awslogs.data;

  const bufferEventData = Buffer.from(EncodingEventData, 'base64');

  const eventData = await gunzipAndDecodeAsync(bufferEventData);

  const slackData = {
    mrkdwn: true,
    attachments: [] as SlackMessage[]
  };

  const message = {} as SlackMessage;

  message.color = '#ffc107';
  message.title = 'Lambda Error';
  message.text = eventData.logEvents[0].message;
  message.ts = Math.floor(Date.now() / 1000);
  message.footer = `cloudwatch: ${eventData.logGroup}`;

  slackData.attachments.push(message);

  const stringSlackData = JSON.stringify(slackData);

  const options = {
    hostname: 'hooks.slack.com',
    port: 443,
    path: process.env.SLACK_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': stringSlackData.length
    }
  };

  return await sendMessageToSlack(options, slackData);
};
