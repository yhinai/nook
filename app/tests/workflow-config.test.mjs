import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkflowConfig, workflowCapabilities } from '../lib/workflow-config.ts';

test('workflow credentials are optional and capabilities only describe configuration', () => {
  const config = readWorkflowConfig({}, {});
  assert.deepEqual(config, {});
  assert.deepEqual(workflowCapabilities(config), {
    researchConfigured: false,
    deploymentConfigured: false,
    browserConfigured: false,
    registrationConfigured: false,
  });
});

test('worker bindings take precedence and blank bindings fall back to the server environment', () => {
  const config = readWorkflowConfig({ EXA_API_KEY: ' binding-research ', FLY_API_TOKEN: '  ', KERNEL_API_KEY: 'binding-browser' }, {
    EXA_API_KEY: 'environment-research',
    FLY_API_TOKEN: 'environment-deployment',
    KERNEL_API_KEY: 'environment-browser',
    NOOK_REGISTRATION_KEY: 'environment-registration',
  });
  assert.deepEqual(config, {
    exaApiKey: 'binding-research',
    flyApiToken: 'environment-deployment',
    kernelApiKey: 'binding-browser',
    registrationKey: 'environment-registration',
  });
  const capabilities = workflowCapabilities(config);
  assert.equal(Object.values(capabilities).every(value => value === true), true);
  assert.equal(JSON.stringify(capabilities).includes('environment-'), false);
  assert.equal(JSON.stringify(capabilities).includes('binding-'), false);
});

test('malformed credentials fail with variable names and no secret values', () => {
  assert.throws(() => readWorkflowConfig({ EXA_API_KEY: { private: 'never-in-errors' } }, {}), { message: 'Invalid server configuration: EXA_API_KEY' });
  assert.throws(() => readWorkflowConfig({}, { KERNEL_API_KEY: 'private-value\ninjected-header' }), { message: 'Invalid server configuration: KERNEL_API_KEY' });
  assert.throws(() => readWorkflowConfig({ FLY_API_TOKEN: 'private\0value' }, {}), { message: 'Invalid server configuration: FLY_API_TOKEN' });
  assert.deepEqual(readWorkflowConfig({}, { EXA_API_KEY: '  ', NOOK_REGISTRATION_KEY: '' }), {});
});

test('workflow configuration cannot be read from a browser runtime', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  try {
    assert.throws(() => readWorkflowConfig({}, {}), { message: 'Workflow configuration is server-only.' });
    assert.throws(() => workflowCapabilities({}), { message: 'Workflow configuration is server-only.' });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  }
});
