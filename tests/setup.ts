/**
 * Config is validated at import time and the process exits when it is invalid,
 * so the test environment has to exist before any module under test loads.
 * These values are fixtures, not secrets.
 */
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://app.example.com';
// Integration tests reuse a real database when one is pointed at; unit tests
// only need the value to parse.
process.env.DATABASE_URL ||= 'postgres://postgres@127.0.0.1:5432/test';
process.env.DATABASE_SSL ||= 'disable';
process.env.SHOPIFY_API_KEY = 'test_api_key';
process.env.SHOPIFY_API_SECRET = 'test_api_secret_value';
process.env.SHOPIFY_SCOPES = 'read_products,write_products,write_files';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.LOG_LEVEL = 'error';
