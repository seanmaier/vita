import { handleEmail, type Env } from './handler.ts';

export default {
  email: (message: ForwardableEmailMessage, env: Env): Promise<void> => handleEmail(message, env).then(() => {}),
};
