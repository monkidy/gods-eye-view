import {
  createGateway as createReader,
  resourceQuery,
  imageType,
  CSP,
} from './server.cjs';
import { normalize } from '../model.js';

export const createGateway = (options = {}) =>
  createReader({ normalize, ...options });
export { resourceQuery, imageType, CSP };
if (typeof require === 'undefined' || require.main === module)
  createGateway().listen(
    Number(process.env.WORLDS_EYE_PORT || 5204),
    '127.0.0.1',
    () => process.stdout.write('WORLDS_EYE_PRIVATE_READ_ONLY_GATEWAY=READY\n'),
  );
