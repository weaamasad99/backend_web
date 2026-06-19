const User = require('../models/User');
const Paper = require('../models/Paper');

const seedDatabase = async () => {
  try {
    // 1. Check/create default lecturer user
    let lecturer = await User.findOne({ role: 'lecturer' });
    if (!lecturer) {
      lecturer = await User.create({
        firebaseUid: 'dummy-lecturer-uid',
        name: 'Dr. Sarah Johnson',
        email: 'lecturer@university.edu',
        role: 'lecturer',
        profilePicture: '',
      });
      console.log('Seeded default lecturer user:', lecturer.name);
    }

    // 2. Check if papers collection is empty
    const paperCount = await Paper.countDocuments({});
    if (paperCount === 0) {
      const mockArticles = [
        {
          title: 'Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey',
          authors: ['Dr. Sarah Johnson', 'Prof. Michael Chen', 'Dr. Emily Rodriguez'],
          abstract: 'This paper presents a comprehensive survey of deep learning techniques applied to natural language processing tasks. We examine recent advances in transformer architectures, pre-trained language models, and their applications across various NLP domains including machine translation, sentiment analysis, and question answering.',
          content: 'Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey. Abstract: This paper presents a comprehensive survey of deep learning techniques applied to natural language processing tasks. We examine recent advances in transformer architectures, pre-trained language models, and their applications across various NLP domains including machine translation, sentiment analysis, and question answering. Key Findings: Transformer models outperform traditional RNNs by 23% on average; Pre-training on large corpora significantly improves downstream task performance; Attention mechanisms enable better context understanding; Model size correlates with performance up to a saturation point. Methodology: Literature Review and Comparative Analysis.',
          pdfUrl: '#',
          topics: ['Deep Learning', 'NLP', 'Transformers', 'Language Models'],
          tags: ['Deep Learning', 'NLP', 'Transformers', 'Language Models'],
          methodology: 'Literature Review and Comparative Analysis',
          keyFindings: [
            'Transformer models outperform traditional RNNs by 23% on average',
            'Pre-training on large corpora significantly improves downstream task performance',
            'Attention mechanisms enable better context understanding',
            'Model size correlates with performance up to a saturation point'
          ],
          citations: 342,
          year: 2025,
          uploadedBy: lecturer._id,
        },
        {
          title: 'Quantum Computing Applications in Cryptography: Challenges and Opportunities',
          authors: ['Prof. David Zhang', 'Dr. Lisa Anderson'],
          abstract: 'We explore the intersection of quantum computing and modern cryptography, analyzing both the threats posed by quantum algorithms to current encryption methods and the opportunities for quantum-resistant cryptographic protocols.',
          content: 'Quantum Computing Applications in Cryptography: Challenges and Opportunities. Abstract: We explore the intersection of quantum computing and modern cryptography, analyzing both the threats posed by quantum algorithms to current encryption methods and the opportunities for quantum-resistant cryptographic protocols. Key Findings: Shors algorithm poses significant threat to RSA encryption; Lattice-based cryptography shows promise for quantum resistance; Current quantum computers still limited by coherence time; Hybrid classical-quantum approaches offer near-term solutions. Methodology: Experimental Study with Simulations.',
          pdfUrl: '#',
          topics: ['Quantum Computing', 'Cryptography', 'Security', 'Post-Quantum'],
          tags: ['Quantum Computing', 'Cryptography', 'Security', 'Post-Quantum'],
          methodology: 'Experimental Study with Simulations',
          keyFindings: [
            'Shor\'s algorithm poses significant threat to RSA encryption',
            'Lattice-based cryptography shows promise for quantum resistance',
            'Current quantum computers still limited by coherence time',
            'Hybrid classical-quantum approaches offer near-term solutions'
          ],
          citations: 187,
          year: 2025,
          uploadedBy: lecturer._id,
        },
        {
          title: 'Climate Change Impact on Marine Biodiversity: A Meta-Analysis',
          authors: ['Dr. Emma Thompson', 'Prof. James Wilson', 'Dr. Maria Garcia', 'Dr. Ahmed Hassan'],
          abstract: 'This meta-analysis examines 150 studies on climate change effects on marine ecosystems. We quantify biodiversity loss, species migration patterns, and ecosystem resilience across different oceanic regions.',
          content: 'Climate Change Impact on Marine Biodiversity: A Meta-Analysis. Abstract: This meta-analysis examines 150 studies on climate change effects on marine ecosystems. We quantify biodiversity loss, species migration patterns, and ecosystem resilience across different oceanic regions. Key Findings: Average 15% decline in marine biodiversity over past decade; Coral reef ecosystems most severely affected; Poleward migration of fish species accelerating; Ocean acidification compounds temperature effects. Methodology: Meta-Analysis of 150 Studies.',
          pdfUrl: '#',
          topics: ['Climate Change', 'Marine Biology', 'Biodiversity', 'Ecology'],
          tags: ['Climate Change', 'Marine Biology', 'Biodiversity', 'Ecology'],
          methodology: 'Meta-Analysis of 150 Studies',
          keyFindings: [
            'Average 15% decline in marine biodiversity over past decade',
            'Coral reef ecosystems most severely affected',
            'Poleward migration of fish species accelerating',
            'Ocean acidification compounds temperature effects'
          ],
          citations: 521,
          year: 2024,
          uploadedBy: lecturer._id,
        },
        {
          title: 'Machine Learning for Medical Diagnosis: A Clinical Trial Study',
          authors: ['Dr. Robert Kim', 'Dr. Patricia Martinez'],
          abstract: 'We present results from a multi-center clinical trial evaluating machine learning algorithms for early disease detection. The study includes data from 50,000 patients across 20 medical centers.',
          content: 'Machine Learning for Medical Diagnosis: A Clinical Trial Study. Abstract: We present results from a multi-center clinical trial evaluating machine learning algorithms for early disease detection. The study includes data from 50,000 patients across 20 medical centers. Key Findings: 94% accuracy in early cancer detection; Reduced false positive rate by 31% compared to traditional methods; Average diagnosis time reduced from 3 weeks to 48 hours; Cost reduction of 42% per patient screening. Methodology: Multi-Center Clinical Trial (n=50,000).',
          pdfUrl: '#',
          topics: ['Machine Learning', 'Healthcare', 'Medical Diagnosis', 'AI'],
          tags: ['Machine Learning', 'Healthcare', 'Medical Diagnosis', 'AI'],
          methodology: 'Multi-Center Clinical Trial (n=50,000)',
          keyFindings: [
            '94% accuracy in early cancer detection',
            'Reduced false positive rate by 31% compared to traditional methods',
            'Average diagnosis time reduced from 3 weeks to 48 hours',
            'Cost reduction of 42% per patient screening'
          ],
          citations: 289,
          year: 2025,
          uploadedBy: lecturer._id,
        },
        {
          title: 'Renewable Energy Integration in Smart Grids: Optimization Strategies',
          authors: ['Prof. Anna Kowalski', 'Dr. Thomas Brown', 'Dr. Yuki Tanaka'],
          abstract: 'This paper investigates optimization strategies for integrating renewable energy sources into existing power grids. We propose novel algorithms for load balancing and energy storage management.',
          content: 'Renewable Energy Integration in Smart Grids: Optimization Strategies. Abstract: This paper investigates optimization strategies for integrating renewable energy sources into existing power grids. We propose novel algorithms for load balancing and energy storage management. Key Findings: Dynamic load balancing improves grid stability by 37%; Optimal battery storage reduces energy waste by 28%; Peak demand can be reduced through predictive algorithms; Integration costs decrease with grid modernization. Methodology: Simulation and Field Testing.',
          pdfUrl: '#',
          topics: ['Renewable Energy', 'Smart Grids', 'Optimization', 'Sustainability'],
          tags: ['Renewable Energy', 'Smart Grids', 'Optimization', 'Sustainability'],
          methodology: 'Simulation and Field Testing',
          keyFindings: [
            'Dynamic load balancing improves grid stability by 37%',
            'Optimal battery storage reduces energy waste by 28%',
            'Peak demand can be reduced through predictive algorithms',
            'Integration costs decrease with grid modernization'
          ],
          citations: 156,
          year: 2025,
          uploadedBy: lecturer._id,
        },
      ];

      await Paper.insertMany(mockArticles);
      console.log('Successfully seeded mock papers database!');
    }
  } catch (error) {
    console.error('Error seeding database:', error.message);
  }
};

module.exports = seedDatabase;
