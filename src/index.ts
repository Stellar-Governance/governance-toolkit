/** Name of this package, used in logs and the health endpoint. */
export const PACKAGE_NAME = 'governance-toolkit';

/**
 * Returns the package name and version string shown by the health endpoint.
 * @param version - the version to report; must be non-empty.
 * @throws {RangeError} when `version` is empty.
 */
export function describe(version: string): string {
  if (version.length === 0) {
    throw new RangeError('version must not be empty');
  }
  return `${PACKAGE_NAME} ${version}`;
}
