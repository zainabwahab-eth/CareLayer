import { createContext } from 'react';
import type { CareLayerApi } from './types';

export const ApiContext = createContext<CareLayerApi | null>(null);
