import { test, expect } from '@playwright/test';
test('search, inspect candidates, move pin and submit for review',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Opp. Demo Palm Market, Ikeja'}).click();
  await expect(page.getByText('Possible landmarks')).toBeVisible();
  await expect(page.getByText('demo palm market',{exact:true})).toBeVisible();
  await expect(page.getByText('Move the pin or edit a coordinate before submitting.')).toBeVisible();
  await page.getByLabel('Latitude',{exact:true}).fill('6.602');
  await page.getByLabel('Longitude',{exact:true}).fill('3.352');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Submit pin for review'}).click();
  await expect(page.getByText('Pin submitted for review.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});
test('ambiguous and empty searches ask for a pin',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'A landmark with two possible locations'}).click();
  await expect(page.getByText(/More than one place could fit/)).toBeVisible();
  await page.getByLabel('Where are you trying to find?').fill('Ikeja');
  await page.getByRole('button',{name:'Find this address'}).click();
  await expect(page.getByText(/No usable match/)).toBeVisible();
});
test('loading and API errors are explicit and recoverable',async({page})=>{
  let release;
  const gate = new Promise(resolve=>{release=resolve;});
  await page.route('**/api/geocode',async route=>{
    await gate;
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Data service unavailable. Please try again.'})});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Opp. Demo Palm Market, Ikeja'}).click();
  await expect(page.getByRole('button',{name:'Finding landmarks…'})).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText('Data service unavailable');
  await expect(page.getByRole('button',{name:'Find this address'})).toBeEnabled();
});
