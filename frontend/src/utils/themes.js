export function savedUserTheme(user, storage = localStorage) {
  return storage.getItem(`team_tasks_theme_user_${user.id}`)
    || user.theme_id
    || storage.getItem('team_tasks_theme')
    || 'light'
}

export function rememberTheme(theme, user, storage = localStorage) {
  storage.setItem('team_tasks_theme', theme)
  if (user) storage.setItem(`team_tasks_theme_user_${user.id}`, theme)
}
