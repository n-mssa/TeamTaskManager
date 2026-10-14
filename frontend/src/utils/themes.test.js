import test from 'node:test'
import assert from 'node:assert/strict'
import { rememberTheme, savedUserTheme } from './themes.js'

function storage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('sage survives refresh when the server still returns the old theme', () => {
  const local = storage()
  const user = { id: 1, theme_id: 'light' }
  rememberTheme('sage', user, local)
  assert.equal(savedUserTheme({ ...user }, local), 'sage')
  assert.equal(local.getItem('team_tasks_theme'), 'sage')
})

test('one user does not override another users account theme', () => {
  const local = storage()
  rememberTheme('sage', { id: 1 }, local)
  assert.equal(savedUserTheme({ id: 2, theme_id: 'dark' }, local), 'dark')
})

test('fresh browser uses the account preference and supports legacy themes', () => {
  for (const theme of ['light', 'dark', 'blue', 'green', 'orange', 'sage']) {
    assert.equal(savedUserTheme({ id: 1, theme_id: theme }, storage()), theme)
  }
})
