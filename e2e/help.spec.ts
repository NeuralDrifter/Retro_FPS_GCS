import { expect, test, waitForGcsEvent } from './fixtures';

// Onboarding and help (release plan P6.7)

test.describe('first visit', () => {
  test.use({ firstVisit: true });

  test('shows the welcome screen once', async ({ page }) => {
    await page.goto('./');
    await waitForGcsEvent(page, 'editor-ready');
    const welcome = page.getByRole('dialog', { name: 'Welcome to Retro FPS GCS' });
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('button', { name: 'New project' })).toBeVisible();
    await expect(welcome.getByRole('button', { name: 'Open file' })).toBeVisible();
    await expect(welcome.getByRole('button', { name: 'Open sample' })).toBeVisible();
    await welcome.getByRole('button', { name: 'Close' }).click();
    await expect(welcome).toBeHidden();

    await page.reload();
    await waitForGcsEvent(page, 'editor-ready');
    await expect(page.getByRole('button', { name: 'Export Game' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Welcome to Retro FPS GCS' })).toHaveCount(0);
  });
});

test('About shows the editor, runtime and schema versions; Help lists the shortcuts', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'About' }).click();
  const about = page.getByRole('dialog', { name: 'About Retro FPS GCS' });
  for (const label of ['Editor', 'Game runtime', 'Project file schema', 'Game data schema']) {
    await expect(about.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(about.getByText(/^\d+\.\d+\.\d+$/).first()).toBeVisible();
  await about.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'Keyboard Shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' }).getByText('Ctrl+Z')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Events' })).toBeVisible();
});
