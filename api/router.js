import handler from '../server/runtime.mjs';
import { withVercelRouting } from '../server/vercel.mjs';

export default withVercelRouting(handler);
