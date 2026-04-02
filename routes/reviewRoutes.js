const express = require('express');
const router = express.Router();
const Review = require('../models/Review');

// @route   POST /api/reviews/submit
// @desc    Submit a new review (starts as 'pending')
router.post('/submit', async (req, res) => {
  try {
    const { patientName, rating, comment, reportType } = req.body;
    
    const newReview = new Review({
      patientName,
      rating,
      comment,
      reportType
    });

    await newReview.save();
    res.status(201).json({ success: true, message: "Review submitted for moderation" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// @route   GET /api/reviews/approved
// @desc    Get all reviews with 'approved' status
router.get('/approved', async (req, res) => {
  try {
    const reviews = await Review.find({ status: 'approved' }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

module.exports = router;