import sys
import iterm2


async def main(connection):
    app = await iterm2.async_get_app(connection)
    window = app.current_window or next(iter(app.windows), None)
    if window is None:
        window = await iterm2.Window.async_create(connection)
    if window is None:
        raise RuntimeError('无法创建可显示侧栏的 iTerm2 窗口。')
    await window.async_activate()
    await app.async_activate(raise_all_windows=False)
    tool_url = sys.argv[1] + ('&' if '?' in sys.argv[1] else '?') + 'ui=release-1.1.1'
    await iterm2.async_register_web_view_tool(
        connection, 'Terminal Sidebar', 'local.terminal-sidebar.v2', True, tool_url,
    )
    identifier = iterm2.MainMenu.Toolbelt.SHOW_TOOLBELT.value.identifier
    state = await iterm2.MainMenu.async_get_menu_item_state(connection, identifier)
    if not state.enabled:
        raise RuntimeError('侧栏已注册，但当前窗口暂时不能显示 Toolbelt。')
    if not state.checked:
        await iterm2.MainMenu.async_select_menu_item(connection, identifier)
    state = await iterm2.MainMenu.async_get_menu_item_state(connection, identifier)
    if not state.checked:
        raise RuntimeError('Toolbelt 未能显示，请检查当前 iTerm2 窗口。')
    print('Terminal Sidebar 已注册，当前窗口 Toolbelt 已显示。')


iterm2.run_until_complete(main)
