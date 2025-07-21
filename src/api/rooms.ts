import { Router } from 'express';

const router = Router();

// Placeholder routes for room management
router.get('/public', (req, res) => {
  res.status(501).json({ message: 'Get public rooms endpoint not implemented yet' });
});

router.post('/', (req, res) => {
  res.status(501).json({ message: 'Create room endpoint not implemented yet' });
});

router.put('/:roomId/settings', (req, res) => {
  res.status(501).json({ message: 'Update room settings endpoint not implemented yet' });
});

export { router as roomRoutes };