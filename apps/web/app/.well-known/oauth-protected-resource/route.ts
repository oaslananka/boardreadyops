/** RFC 9728 root discovery must use the SAME fail-closed, first-party OAuth
 * registration as path-aware `/mcp` metadata. The previous external-IDP
 * experiment is not an alternative public authorization server.
 */
export { GET } from "./mcp/route.js";
