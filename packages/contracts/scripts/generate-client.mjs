import { mkdir, readFile, writeFile } from 'node:fs/promises';

import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';
import { format, resolveConfig } from 'prettier';

const checkOnly = process.argv.includes('--check');
const source = new URL('../../../apps/api/openapi.json', import.meta.url);
const destination = new URL('../src/generated/v1.ts', import.meta.url);

const document = JSON.parse(await readFile(source, 'utf8'));
validateDocument(document);

const ast = await openapiTS(document, {
  alphabetize: true,
  defaultNonNullable: false,
  silent: true,
});
const prettierConfig = (await resolveConfig(destination.pathname)) ?? {};
const generated = await format(COMMENT_HEADER + astToString(ast), {
  ...prettierConfig,
  filepath: destination.pathname,
});

if (checkOnly) {
  let current = '';
  try {
    current = await readFile(destination, 'utf8');
  } catch {
    // A missing generated client is contract drift and is reported below.
  }

  if (current !== generated) {
    process.stderr.write(
      'The generated v1 API client is stale. Run npm run openapi:generate and commit the result.\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('Generated v1 API client matches the current OpenAPI document.\n');
  }
} else {
  await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
  await writeFile(destination, generated, 'utf8');
  process.stdout.write('Generated ' + destination.pathname + '\n');
}

function validateDocument(value) {
  if (!value || typeof value !== 'object' || !value.paths) {
    throw new Error('The OpenAPI document does not contain a paths object.');
  }

  const failures = [];
  const operationIds = new Set();
  const methods = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'];

  for (const [path, pathItem] of Object.entries(value.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;

      const label = method.toUpperCase() + ' ' + path;
      if (!operation.operationId) {
        failures.push(label + ' has no operationId.');
      } else if (operationIds.has(operation.operationId)) {
        failures.push(label + ' duplicates operationId ' + operation.operationId + '.');
      } else {
        operationIds.add(operation.operationId);
      }

      const inheritedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
      const operationParameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      const parameters = [...inheritedParameters, ...operationParameters];
      const placeholders = [...path.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]);

      for (const placeholder of placeholders) {
        const parameter = parameters.find(
          (candidate) =>
            candidate &&
            typeof candidate === 'object' &&
            candidate.in === 'path' &&
            candidate.name === placeholder,
        );
        if (!parameter || parameter.required !== true) {
          failures.push(label + ' does not document required path parameter ' + placeholder + '.');
        }
      }

      const successResponses = Object.entries(operation.responses ?? {}).filter(([status]) =>
        /^2\d\d$/u.test(status),
      );
      if (successResponses.length === 0) {
        failures.push(label + ' has no explicit 2xx response.');
      }
      for (const [status, response] of successResponses) {
        if (status !== '204' && (!response || typeof response !== 'object' || !response.content)) {
          failures.push(label + ' response ' + status + ' has no documented content.');
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error('OpenAPI client generation failed:\n- ' + failures.join('\n- '));
  }
}
