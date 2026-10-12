import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RuntimeInstance } from '../api/runtimeApi';
import { configurationState, RuntimeServiceStatus, serviceState } from './RuntimeServiceStatus';
const item = {mode:'docker',observed_state:'running',health:'healthy',kind:'controller',desired_config_version:'new',applied_config_version:'old',last_checked_at:null} as RuntimeInstance;
describe('Operational status vocabulary',()=>{
 it('does not equate a running healthy container with confirmed equipment control',()=>{
  expect(serviceState(item)).toBe('Service started');render(<RuntimeServiceStatus item={item}/>);
  expect(screen.getByText('Not confirmed')).toBeInTheDocument();expect(screen.getByText('Changes pending')).toBeInTheDocument();
 });
 it('distinguishes unapplied, applied and simulated configuration',()=>{
  expect(configurationState({...item,applied_config_version:null})).toBe('Awaiting confirmation');
  expect(configurationState({...item,applied_config_version:'new'})).toBe('Up to date');
  expect(configurationState({...item,desired_config_version:null})).toBe('Not prepared');
  expect(serviceState({...item,mode:'simulation'})).toBe('Simulation');
  expect(serviceState({...item,health:'unhealthy'})).toBe('Needs attention');
 });
});
