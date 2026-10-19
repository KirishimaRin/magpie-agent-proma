// Runs in Magpie's moejs sandbox: deliberately no Node APIs or network access.
export const agent = {
  id: 'proma',
  name: 'Proma',
  dir: '~/.proma',
  config: '~/.proma/magpie-bridge.json',
  format: 'json',
  ua: ['proma'],
  notice: '模型在 Proma 内选择。接入或断开后，请从托盘完全退出并重开 Proma；断开时会在退出后删除插件专用渠道。',
};

// Omitting agent.model keeps the full model picker inside Proma.
export function connect({ gateway, models }) {
  if (!gateway?.url || !gateway?.key || !Array.isArray(models) || !models.length) {
    throw new Error('Proma 接入需要有效的网关和至少一个可见模型。');
  }
  return {
    'bridge.version': 1,
    'bridge.gateway': gateway.url,
    'bridge.key': gateway.key,
    'bridge.models': models.map(model => ({
      id: model.id, name: model.name || model.id,
      ...(Array.isArray(model.efforts) ? { efforts: model.efforts } : {}),
      ...(typeof model.context === 'number' ? { context: model.context } : {}),
      ...(typeof model.output === 'number' ? { output: model.output } : {}),
      ...(typeof model.images === 'boolean' ? { images: model.images } : {}),
    })),
  };
}
