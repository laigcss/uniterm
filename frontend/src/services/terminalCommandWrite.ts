import { queuedSessionWrite as queueRawSessionWrite } from './sessionWriter'
import { getManagedTerminal } from './terminalManager'
import { observeCommandInput } from './terminalCommandWrap'

// Wrap every session write so command-wrap detection (issue #1270) sees user
// input as it is typed. Only observe terminals with at least one active
// component — a frozen background terminal has no live cursor to track and
// observing it would just accumulate state nobody will ever read.
//
// This indirection exists to avoid a circular import: terminalManager already
// imports sessionWriter, so sessionWriter cannot import terminalManager back.
// Composables that write to the session import this wrapper instead of the
// raw sessionWriter, keeping the observation hook in one place.
export function queuedSessionWrite(sessionId: string, data: string): void {
  const managed = getManagedTerminal(sessionId)
  if (managed && managed.activeRefs.size > 0) observeCommandInput(managed.terminal, data)
  queueRawSessionWrite(sessionId, data)
}