/** ACP sessionUpdate discriminator values used across the agent. */
export enum SessionUpdateType {
  AgentMessageChunk = "agent_message_chunk",
  AgentThoughtChunk = "agent_thought_chunk",
  UserMessageChunk = "user_message_chunk",
  SessionInfoUpdate = "session_info_update",
  ConfigOptionUpdate = "config_option_update",
  AvailableCommandsUpdate = "available_commands_update",
  ToolCall = "tool_call",
  ToolCallUpdate = "tool_call_update",
}
