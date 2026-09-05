import { describe, expect, it } from 'vitest';
import { identityFromUser, needsIdentity, resolveDisplayName } from './identity.js';

const googleUser = (meta = {}) => ({
  id: 'u1',
  email: 'ada.lovelace@example.com',
  app_metadata: { provider: 'google' },
  user_metadata: {
    full_name: 'Ada Lovelace',
    avatar_url: 'https://lh3.googleusercontent.com/a/ada',
    ...meta,
  },
});

describe('identityFromUser', () => {
  it('reads a Google profile name and photo', () => {
    const id = identityFromUser(googleUser());
    expect(id.name).toBe('Ada Lovelace');
    expect(id.avatarUrl).toBe('https://lh3.googleusercontent.com/a/ada');
    expect(id.provider).toBe('google');
    expect(id.isGuest).toBe(false);
  });

  it('composes a name from given and family parts when there is no combined one', () => {
    const user = googleUser({ full_name: undefined, name: undefined, given_name: 'Grace', family_name: 'Hopper' });
    expect(identityFromUser(user).name).toBe('Grace Hopper');
  });

  it('falls back to the email local part, tidied', () => {
    const user = { id: 'u2', email: 'alan.turing@example.com', user_metadata: {} };
    expect(identityFromUser(user).name).toBe('Alan Turing');
  });

  it('reports no name rather than inventing one', () => {
    // "Player" is a caller's decision. Returning it here would make "we know
    // who this is" indistinguishable from "we gave up".
    const user = { id: 'u3', user_metadata: {}, is_anonymous: true };
    const id = identityFromUser(user);
    expect(id.name).toBeNull();
    expect(id.isGuest).toBe(true);
    expect(id.provider).toBe('anonymous');
  });

  it('is safe on a signed-out caller', () => {
    expect(identityFromUser(null).name).toBeNull();
    expect(identityFromUser(undefined).isGuest).toBe(false);
  });

  it('ignores blank metadata rather than treating it as a name', () => {
    const user = googleUser({ full_name: '   ', name: 'Ada L' });
    expect(identityFromUser(user).name).toBe('Ada L');
  });
});

describe('resolveDisplayName', () => {
  it('prefers a name the person set themselves', () => {
    // A later Google sign-in must not overwrite a name chosen by hand.
    expect(resolveDisplayName({ name: 'Countess' }, googleUser())).toBe('Countess');
  });

  it('falls through to the provider when the local profile is empty', () => {
    expect(resolveDisplayName({ name: '' }, googleUser())).toBe('Ada Lovelace');
    expect(resolveDisplayName({ name: '   ' }, googleUser())).toBe('Ada Lovelace');
  });

  it('is empty when nothing knows a name', () => {
    expect(resolveDisplayName({ name: '' }, null)).toBe('');
  });
});

describe('needsIdentity', () => {
  it('is false for a Google user who has never seen onboarding', () => {
    // The whole point: `onboarded` is false on a fresh device, but Google has
    // already told us the name, so there is nothing left to ask.
    expect(needsIdentity({ name: '', onboarded: false }, googleUser())).toBe(false);
  });

  it('is false for a guest whose generated name was kept', () => {
    expect(needsIdentity({ name: 'Swift Otter', onboarded: false }, null)).toBe(false);
  });

  it('is true only when no name exists anywhere', () => {
    expect(needsIdentity({ name: '', onboarded: false }, null)).toBe(true);
  });
});
