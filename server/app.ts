import { Hono } from 'hono';
import { createConversationRoutes } from './routes/conversation.ts';
import{createSystemRoutes} from './routes/system.ts';
import pino from 'pino';
import { pinoLogger, type Env as HonoPinoEnv } from 'hono-pino';
import { errorResponse } from './error.ts';
import type { ConversationService } from './conversation/service.ts';


export function createApp(conversationService:ConversationService): Hono<HonoPinoEnv> {
    const app = new Hono<HonoPinoEnv>();
    const log = pino({
        level: process.env.LOG_LEVEL ?? "info",
        transport: process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    singleLine: true,
                },
            },
    });
    app.use(
        "*",
        pinoLogger({
            pino: log,
        }),
    );

    app.onError((err, ctx) => {
        ctx.var.logger.error(
            {
                err,
                method: ctx.req.method,
                path: ctx.req.path,
            },
            'Request failed',
        );
        return ctx.json(errorResponse(err), 500);
    });

    app.get('/', (c) => c.text('Hello, Hono!'));
    app.route('/api/conversation', createConversationRoutes(conversationService));
    app.route('/api/system', createSystemRoutes());

    return app;
}


